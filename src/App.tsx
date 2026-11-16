import { useEffect, useRef, useState, type ChangeEvent, type FormEvent } from "react";
import {
  assessmentSchema,
  type AnalyzeContext,
  type Assessment,
  type StressLikelihood,
} from "../shared/contract";

type AppStatus = "idle" | "image-selected" | "analyzing" | "success" | "error";
type ContextField = keyof AnalyzeContext;

const MAX_FILE_BYTES = 8 * 1024 * 1024;
const ACCEPTED_TYPES = ["image/jpeg", "image/png", "image/webp"];
const initialContext: AnalyzeContext = {
  plantType: "",
  symptoms: "",
  watering: "",
  light: "",
  recentChanges: "",
};

function isApiError(value: unknown): value is { error: { message: string } } {
  if (!value || typeof value !== "object" || !("error" in value)) return false;
  const error = value.error;
  return Boolean(error && typeof error === "object" && "message" in error && typeof error.message === "string");
}

function likelihoodLabel(likelihood: StressLikelihood): string {
  return likelihood === "likely" ? "More likely" : likelihood === "possible" ? "Possible" : "Uncertain";
}

export default function App() {
  const [status, setStatus] = useState<AppStatus>("idle");
  const [file, setFile] = useState<File | null>(null);
  const [assessment, setAssessment] = useState<Assessment | null>(null);
  const [context, setContext] = useState<AnalyzeContext>(initialContext);
  const [errorMessage, setErrorMessage] = useState("");
  const [previewUrl, setPreviewUrl] = useState("");
  const pickerRef = useRef<HTMLInputElement>(null);
  const cameraRef = useRef<HTMLInputElement>(null);
  const requestRef = useRef<AbortController | null>(null);
  const requestIdRef = useRef(0);

  useEffect(() => {
    if (!file) {
      setPreviewUrl("");
      return;
    }
    const url = URL.createObjectURL(file);
    setPreviewUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [file]);

  useEffect(() => () => requestRef.current?.abort(), []);

  function cancelCurrentRequest() {
    requestIdRef.current += 1;
    requestRef.current?.abort();
    requestRef.current = null;
  }

  function selectImage(event: ChangeEvent<HTMLInputElement>) {
    const nextFile = event.target.files?.[0];
    event.target.value = "";
    if (!nextFile) return;

    cancelCurrentRequest();
    setAssessment(null);
    setErrorMessage("");
    if (!ACCEPTED_TYPES.includes(nextFile.type)) {
      setFile(null);
      setStatus("error");
      setErrorMessage("That file type is not supported. Choose a JPEG, PNG, or WebP image.");
      return;
    }
    if (nextFile.size > MAX_FILE_BYTES) {
      setFile(null);
      setStatus("error");
      setErrorMessage("That image is larger than 8 MB. Choose a smaller image and try again.");
      return;
    }

    setFile(nextFile);
    setStatus("image-selected");
  }

  function reset() {
    cancelCurrentRequest();
    setFile(null);
    setAssessment(null);
    setContext(initialContext);
    setErrorMessage("");
    setStatus("idle");
  }

  function updateContext(field: ContextField, value: string) {
    setContext((current) => ({ ...current, [field]: value }));
  }

  async function submitAnalysis(event?: FormEvent<HTMLFormElement>) {
    event?.preventDefault();
    if (!file || status === "analyzing") return;

    cancelCurrentRequest();
    const requestId = requestIdRef.current;
    const controller = new AbortController();
    requestRef.current = controller;
    setAssessment(null);
    setErrorMessage("");
    setStatus("analyzing");

    const body = new FormData();
    body.append("image", file);
    for (const [field, value] of Object.entries(context)) {
      if (value.trim()) body.append(field, value.trim());
    }

    try {
      const response = await fetch("/api/analyze", {
        method: "POST",
        body,
        signal: controller.signal,
      });
      let payload: unknown;
      try {
        payload = await response.json();
      } catch {
        throw new Error("The service returned an unreadable response. Please try again.");
      }
      if (!response.ok) {
        throw new Error(isApiError(payload) ? payload.error.message : "Plant analysis is temporarily unavailable. Please try again.");
      }
      const parsed = assessmentSchema.safeParse(payload);
      if (!parsed.success) {
        throw new Error("The service returned an incomplete result. Please try again.");
      }
      if (requestId === requestIdRef.current) {
        setAssessment(parsed.data);
        setStatus("success");
      }
    } catch (error) {
      if (controller.signal.aborted || requestId !== requestIdRef.current) return;
      setErrorMessage(error instanceof Error ? error.message : "Plant analysis is temporarily unavailable. Please try again.");
      setStatus("error");
    } finally {
      if (requestId === requestIdRef.current) requestRef.current = null;
    }
  }

  const canAnalyze = Boolean(file) && status !== "analyzing";

  return (
    <div className="app-shell">
      <header className="site-header">
        <a className="brand" href="#" aria-label="Plant Stress Insight home" onClick={(event) => { event.preventDefault(); reset(); }}>
          <span className="brand-mark" aria-hidden="true"><LeafIcon /></span>
          <span>Plant<span className="brand-light">wise</span></span>
        </a>
        <span className="header-note"><span className="status-dot" /> Thoughtful guidance for growing things</span>
      </header>

      <main>
        <section className="intro" aria-labelledby="page-title">
          <div className="hero-copy">
            <div className="eyebrow"><span className="eyebrow-line" /> PLANT STRESS INSIGHT · A THOUGHTFUL FIRST LOOK</div>
            <h1 id="page-title">A little more clarity.<br /><em>A lot more growing.</em></h1>
            <p className="intro-copy">Every plant tells a story. Share a photo and a little context to find grounded observations and gentle next steps—not a definitive diagnosis.</p>
            <div className="hero-points" aria-label="How this works">
              <span><span className="hero-point-icon"><EyeIcon /></span>Notice what’s visible</span>
              <span><span className="hero-point-icon"><SparkleIcon /></span>Explore what might help</span>
            </div>
          </div>
          <div className="hero-art" aria-hidden="true">
            <div className="hero-art-wash" />
            <BotanicalArtwork />
            <div className="hero-art-label"><span className="hero-art-label-dot" /><span><strong>Grow with a little more confidence</strong><small>Thoughtful plant care, one leaf at a time</small></span></div>
            <span className="hero-art-index">01 — 02</span>
          </div>
        </section>

        <div className="workspace">
          <section className="upload-panel panel" aria-labelledby="photo-heading">
            <div className="panel-heading">
              <span className="step-number">01</span>
              <div>
                <h2 id="photo-heading">Start with a photo</h2>
                <p>A clear view of the leaves helps most.</p>
              </div>
            </div>

            {!file ? (
              <div className={`upload-dropzone ${status === "error" ? "has-error" : ""}`}>
                <span className="upload-illustration" aria-hidden="true"><PhotoIcon /></span>
                <p className="upload-title">Add a photo of your plant</p>
                <p className="upload-hint">JPEG, PNG, or WebP · up to 8 MB</p>
                <div className="upload-actions">
                  <button className="button button-primary" type="button" onClick={() => pickerRef.current?.click()}>
                    <UploadIcon /> Choose a photo
                  </button>
                  <button className="button button-secondary" type="button" onClick={() => cameraRef.current?.click()}>
                    <CameraIcon /> Take a photo
                  </button>
                </div>
                <input ref={pickerRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES.join(",")} onChange={selectImage} aria-label="Choose a plant photo" />
                <input ref={cameraRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES.join(",")} capture="environment" onChange={selectImage} aria-label="Take a plant photo" />
              </div>
            ) : (
              <div className="preview-card">
                <div className="preview-image-wrap">
                  {previewUrl && <img className="plant-preview" src={previewUrl} alt="Preview of the selected plant photo" />}
                  {status === "analyzing" && (
                    <div className="image-processing" role="status">
                      <span className="spinner" aria-hidden="true" />
                      <span>Looking closely…</span>
                    </div>
                  )}
                </div>
                <div className="preview-meta">
                  <div className="file-details"><PhotoIcon /><span className="file-name">{file.name}</span><span>{(file.size / (1024 * 1024)).toFixed(1)} MB</span></div>
                  <div className="preview-actions">
                    <button className="text-button" type="button" onClick={() => pickerRef.current?.click()}>Replace photo</button>
                    <button className="icon-button" type="button" onClick={reset} aria-label="Remove photo"><CloseIcon /></button>
                  </div>
                  <input ref={pickerRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES.join(",")} onChange={selectImage} aria-label="Replace plant photo" />
                </div>
                <input ref={cameraRef} className="visually-hidden" type="file" accept={ACCEPTED_TYPES.join(",")} capture="environment" onChange={selectImage} aria-label="Take a replacement plant photo" />
              </div>
            )}

            <details className="context-details">
              <summary><span className="context-summary-icon"><PlusIcon /></span><span><strong>Add a little context</strong><small>Optional, but it can make the guidance more useful</small></span><ChevronIcon /></summary>
              <div className="context-fields">
                <label>Plant type <span>if you know it</span><input value={context.plantType} onChange={(event) => updateContext("plantType", event.target.value)} maxLength={120} placeholder="e.g. Monstera, basil, not sure" /></label>
                <label>What have you noticed?<textarea value={context.symptoms} onChange={(event) => updateContext("symptoms", event.target.value)} maxLength={1000} placeholder="Changes in color, texture, growth, or anything else…" rows={3} /></label>
                <div className="field-row">
                  <label>Watering<textarea value={context.watering} onChange={(event) => updateContext("watering", event.target.value)} maxLength={400} placeholder="How often, roughly?" rows={2} /></label>
                  <label>Light<textarea value={context.light} onChange={(event) => updateContext("light", event.target.value)} maxLength={400} placeholder="Where does it sit?" rows={2} /></label>
                </div>
                <label>Recent changes <span>optional</span><input value={context.recentChanges} onChange={(event) => updateContext("recentChanges", event.target.value)} maxLength={600} placeholder="Moved, repotted, new season…" /></label>
              </div>
            </details>

            {status === "error" && (
              <div className="error-message" role="alert">
                <span className="error-icon" aria-hidden="true"><AlertIcon /></span>
                <div><strong>We couldn’t complete that.</strong><p>{errorMessage}</p></div>
              </div>
            )}

            <form onSubmit={submitAnalysis}>
              <button className="button button-primary analyze-button" type="submit" disabled={!canAnalyze}>
                {status === "analyzing" ? <><span className="spinner spinner-light" aria-hidden="true" /> Taking a closer look…</> : <>Get plant insights <ArrowIcon /></>}
              </button>
            </form>

            <div className="privacy-note"><LockIcon /><p><strong>Your photo is only used for this analysis.</strong> It’s sent to the configured AI provider; that provider’s terms govern how it may be retained. We don’t save your photo or results.</p></div>
          </section>

          <section className="result-panel panel" aria-labelledby="result-heading" aria-live="polite">
            <div className="panel-heading result-panel-heading">
              <span className="step-number">02</span>
              <div><h2 id="result-heading">Your plant insight</h2><p>A starting point, not a diagnosis.</p></div>
              {status === "success" && <button className="print-button" type="button" onClick={() => window.print()}><PrintIcon /> Print / save PDF</button>}
            </div>
            {status === "success" && assessment ? (
              <div className="report" id="plant-report">
                <div className="report-photo-wrap">
                  {previewUrl && <img className="report-photo" src={previewUrl} alt="Your plant photo" />}
                  <div className="report-photo-label"><LeafIcon /> Photo you shared</div>
                </div>
                <div className="report-content">
                  <div className="report-kicker"><span className="status-dot" /> Your first look</div>
                  <p className="report-summary">{assessment.summary}</p>
                  <div className="report-section">
                    <h3><span className="section-icon observation-icon"><EyeIcon /></span>What’s visible</h3>
                    <ul>{assessment.observations.map((observation, index) => <li key={`${index}-${observation}`}>{observation}</li>)}</ul>
                  </div>
                  <div className="report-section">
                    <h3><span className="section-icon stress-icon"><SparkleIcon /></span>What might be going on</h3>
                    <div className="stressor-list">{assessment.possibleStressors.length > 0 ? assessment.possibleStressors.map((stressor, index) => (
                      <article className="stressor-card" key={`${index}-${stressor.name}`}>
                        <div className="stressor-title"><h4>{stressor.name}</h4><span className={`likelihood likelihood-${stressor.likelihood}`}>{likelihoodLabel(stressor.likelihood)}</span></div>
                        <p>{stressor.reason}</p>
                      </article>
                    )) : <p className="report-empty-note">There isn’t enough visual evidence to suggest a possible stressor.</p>}</div>
                  </div>
                  <div className="report-section care-section">
                    <h3><span className="section-icon care-icon"><HandIcon /></span>Gentle next steps</h3>
                    {assessment.careActions.length > 0
                      ? <ol>{assessment.careActions.map((action, index) => <li key={`${index}-${action}`}><span className="care-number">{index + 1}</span><span>{action}</span></li>)}</ol>
                      : <p className="report-empty-note">No care changes are suggested from this image alone.</p>}
                  </div>
                  <aside className="caveat-box"><span className="caveat-icon"><InfoIcon /></span><div><h3>A note on uncertainty</h3><p>{assessment.uncertainty}</p></div></aside>
                  <aside className="help-note"><strong>When to get another opinion</strong><p>{assessment.whenToSeekHelp}</p></aside>
                  <p className="report-disclaimer">AI-generated information can be incomplete or mistaken. Check your plant’s conditions and use your judgment before making changes.</p>
                </div>
              </div>
            ) : status === "analyzing" ? (
              <div className="result-empty result-loading" role="status">
                <span className="loading-orbit"><LeafIcon /></span>
                <h3>Giving your photo a careful look</h3>
                <p>We’re separating what’s visible from what might be causing it. This usually takes a few moments.</p>
                <div className="loading-progress"><span /></div>
              </div>
            ) : status === "error" ? (
              <div className="result-empty">
                <span className="empty-icon empty-icon-warm"><RetryIcon /></span>
                <h3>Your photo is still here</h3>
                <p>Nothing was saved. You can try the analysis again, or choose another photo.</p>
                {file && <button type="button" className="text-button retry-button" onClick={() => void submitAnalysis()}>Try again <ArrowIcon /></button>}
              </div>
            ) : (
              <div className="result-empty">
                <span className="empty-icon"><SproutIcon /></span>
                <h3>A clearer picture, one step at a time</h3>
                <p>Once you share a photo, you’ll see careful observations, possible stressors, and practical next steps here.</p>
                <div className="empty-points"><span><CheckIcon /> Grounded in what’s visible</span><span><CheckIcon /> Honest about uncertainty</span></div>
              </div>
            )}
          </section>
        </div>


        <section
          aria-labelledby="team-heading"
          style={{
            margin: "4rem auto 2rem",
            maxWidth: "1100px",
            padding: "2.5rem 1.5rem",
            borderRadius: "24px",
            background: "linear-gradient(135deg, #f1f4eb, #e8eee2)",
            border: "1px solid #dce5d5",
          }}
        >
          <div style={{ textAlign: "center", marginBottom: "2rem" }}>
            <p style={{ color: "#71866a", fontSize: "0.75rem", fontWeight: 700, letterSpacing: "0.16em", marginBottom: "0.6rem" }}>
              THE PEOPLE BEHIND PLANTWISE
            </p>
            <h2 id="team-heading" style={{ color: "#263d2c", fontSize: "clamp(1.7rem, 4vw, 2.4rem)", margin: 0 }}>
              Meet Our Team
            </h2>
            <p style={{ color: "#687568", marginTop: "0.7rem" }}>
              The team working together on Plant Stress Insight.
            </p>
          </div>
          <div
            style={{
              display: "grid",
              gridTemplateColumns: "repeat(auto-fit, minmax(145px, 1fr))",
              gap: "1rem",
            }}
          >
            {[
              { name: "LOKESH", id: "25BTRCL132" },
              { name: "CHARITHA", id: "25BTRCL133" },
              { name: "KARTHIK", id: "25BTRCL134" },
              { name: "MUKESH", id: "25BTRCL137" },
              { name: "MANVI", id: "25BTRCL146" },
              { name: "MONIKA", id: "25BTRCL" },
              { name: "SRIRAM", id: "25BTRCL" },
            ].map((member) => (
              <article
                key={member.name}
                style={{
                  padding: "1.25rem 1rem",
                  borderRadius: "16px",
                  background: "rgba(255, 255, 255, 0.82)",
                  border: "1px solid #dce5d5",
                  textAlign: "center",
                  boxShadow: "0 5px 18px rgba(45, 67, 46, 0.06)",
                }}
              >
                <div
                  aria-hidden="true"
                  style={{
                    width: "42px",
                    height: "42px",
                    margin: "0 auto 0.8rem",
                    borderRadius: "50%",
                    display: "grid",
                    placeItems: "center",
                    background: "#e3ebdd",
                    color: "#496b50",
                    fontWeight: 800,
                  }}
                >
                  {member.name.charAt(0)}
                </div>
                <h3 style={{ color: "#2e4934", fontSize: "0.95rem", margin: "0 0 0.4rem" }}>
                  {member.name}
                </h3>
                <p style={{ color: "#788477", fontSize: "0.78rem", margin: 0, overflowWrap: "anywhere" }}>
                  {member.id}
                </p>
              </article>
            ))}
          </div>
        </section>

        <p className="footer-note"><LeafIcon /> Good plant care starts with noticing.</p>
      </main>
      <footer className="site-footer"><span>Plantwise · A helpful first look, never a diagnosis.</span><span>Take care, and grow at your own pace.</span></footer>
    </div>
  );
}

function BotanicalArtwork() {
  return (
    <svg className="botanical-artwork" viewBox="0 0 620 500" fill="none">
      <defs>
        <linearGradient id="leaf-light" x1="140" y1="110" x2="385" y2="370" gradientUnits="userSpaceOnUse">
          <stop stopColor="#91A889" />
          <stop offset="1" stopColor="#496B50" />
        </linearGradient>
        <linearGradient id="leaf-deep" x1="285" y1="130" x2="450" y2="345" gradientUnits="userSpaceOnUse">
          <stop stopColor="#718C69" />
          <stop offset="1" stopColor="#344E3B" />
        </linearGradient>
        <linearGradient id="pot" x1="245" y1="330" x2="402" y2="450" gradientUnits="userSpaceOnUse">
          <stop stopColor="#D0B99A" />
          <stop offset="1" stopColor="#A88F70" />
        </linearGradient>
      </defs>
      <path d="M92 500V220C92 111 180 23 289 23h42c109 0 197 88 197 197v280H92Z" fill="#E9E8DB" />
      <path d="M127 500V222c0-90 73-163 163-163h38c90 0 163 73 163 163v278H127Z" fill="#F0EEE3" />
      <path d="M310 377c-3-93-10-172-24-245M309 377c17-85 45-151 84-202M306 373c-37-64-73-111-119-142M319 376c42-48 83-77 132-93M302 366c-2-50-14-86-34-119" stroke="#667C5F" strokeWidth="5" strokeLinecap="round" />
      <path d="M285 137c-34-34-39-79-11-104 42 17 64 54 46 91-8 17-20 23-35 13Z" fill="url(#leaf-light)" />
      <path d="M261 195c-48-15-76-52-64-88 45-5 82 18 83 58 1 19-6 29-19 30Z" fill="url(#leaf-deep)" />
      <path d="M328 219c-2-49 23-85 61-86 20 40 14 82-20 99-17 9-30 4-41-13Z" fill="url(#leaf-light)" />
      <path d="M201 238c-48 2-82-23-80-60 39-19 80-13 96 20 8 17 3 30-14 40Z" fill="#78916F" />
      <path d="M390 257c17-45 54-66 87-49-2 45-28 78-68 73-19-2-27-12-19-24Z" fill="url(#leaf-deep)" />
      <path d="M282 274c-35-32-42-75-13-102 42 18 62 56 42 92-10 17-22 22-29 10Z" fill="#819777" />
      <path d="M346 304c-2-45 21-77 56-77 18 37 12 75-19 90-16 8-28 4-37-13Z" fill="#587453" />
      <path d="M248 305c-43-13-67-46-56-78 41-4 74 17 75 53 1 17-6 26-19 25Z" fill="url(#leaf-light)" />
      <path d="M318 359c34-28 70-32 91-7-17 34-48 49-76 31-14-9-18-18-15-24Z" fill="#849879" />
      <path d="M252 365c-31-25-38-58-17-80 32 14 48 43 33 70-7 13-16 17-16 10Z" fill="#6F8867" />
      <path d="M285 136c-2-35-7-70-11-89M261 195c-21-26-41-48-58-60M328 219c10-28 30-58 52-78M201 238c-24-13-48-22-70-27M390 257c24-14 54-27 79-32M282 274c-4-31-10-59-19-83M346 304c14-25 34-48 56-63M248 305c-22-22-39-44-53-66" stroke="#BCC5AE" strokeWidth="2" strokeLinecap="round" opacity=".8" />
      <ellipse cx="311" cy="414" rx="105" ry="17" fill="#D9D5C6" />
      <path d="M243 337h137l-12 103c-2 16-14 27-30 27h-52c-16 0-28-11-30-27l-13-103Z" fill="url(#pot)" />
      <path d="M243 337c0-8 7-14 15-14h107c8 0 15 6 15 14v12H243v-12Z" fill="#B59D7D" />
      <path d="M265 365c7 5 13 9 20 11m-16 7c7 5 13 8 19 10m53-22c-6 5-12 9-19 11m14 7c-6 5-12 8-18 10" stroke="#D8C6AA" strokeWidth="3" strokeLinecap="round" opacity=".6" />
      <circle cx="453" cy="115" r="3" fill="#B29B77" />
      <circle cx="175" cy="330" r="4" fill="#B29B77" />
      <path d="M432 151h28" stroke="#B29B77" strokeWidth="1.5" strokeLinecap="round" />
      <path d="M447 137v28" stroke="#B29B77" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  );
}

function LeafIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M20.5 3.5C12 3.4 5.3 5.2 4.1 11.1c-.7 3.4 1.8 5.9 5.1 5.3 5.9-1.1 7.7-7.9 7.7-7.9S12 14.3 5 20.5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /><path d="M4.7 16.4c-.5 1.2-.8 2.5-.9 4.1" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>; }
function PhotoIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><rect x="3" y="4.5" width="18" height="15" rx="2.5" stroke="currentColor" strokeWidth="1.6" /><circle cx="8.5" cy="9.5" r="1.5" stroke="currentColor" strokeWidth="1.5" /><path d="m4 17 5-4 3 2 4-4 4 3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function UploadIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 13V3m0 0L6.5 6.5M10 3l3.5 3.5M4 12.5V16h12v-3.5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function CameraIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M3 6.5h3l1.2-2h5.6l1.2 2h3v9H3v-9Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><circle cx="10" cy="10.8" r="2.6" stroke="currentColor" strokeWidth="1.5" /></svg>; }
function CloseIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 5 10 10M15 5 5 15" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" /></svg>; }
function PlusIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M10 4v12M4 10h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>; }
function ChevronIcon() { return <svg className="chevron-icon" viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m5 7.5 5 5 5-5" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function ArrowIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M4 10h11m0 0-4-4m4 4-4 4" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function LockIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><rect x="4" y="8.5" width="12" height="9" rx="2" stroke="currentColor" strokeWidth="1.4" /><path d="M6.5 8.5V6a3.5 3.5 0 1 1 7 0v2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /><circle cx="10" cy="12.5" r="1" fill="currentColor" /></svg>; }
function PrintIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6 7V3h8v4M5 14H3.5A1.5 1.5 0 0 1 2 12.5v-4A1.5 1.5 0 0 1 3.5 7h13A1.5 1.5 0 0 1 18 8.5v4a1.5 1.5 0 0 1-1.5 1.5H15" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="M5 11h10v6H5v-6Zm9-2h.01" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" strokeLinecap="round" /></svg>; }
function AlertIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m10 2.8 8 14H2l8-14Z" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" /><path d="M10 7.5v4m0 2.5h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>; }
function RetryIcon() { return <svg viewBox="0 0 24 24" fill="none" aria-hidden="true"><path d="M4 11a8 8 0 0 1 14.5-4.7L21 9m0 0V4m0 5h-5M20 13a8 8 0 0 1-14.5 4.7L3 15m0 0v5m0-5h5" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function SproutIcon() { return <svg viewBox="0 0 32 32" fill="none" aria-hidden="true"><path d="M16 27V15m0 6c-5.8 0-9-3-9-8.5 5.8 0 9 2.8 9 8.5Zm0-5c0-6 3.5-9.2 9.5-9.2 0 5.9-3.4 9.2-9.5 9.2Zm-6 11h12" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function CheckIcon() { return <svg viewBox="0 0 16 16" fill="none" aria-hidden="true"><path d="m3.5 8.2 3 3 6-6.4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" /></svg>; }
function EyeIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M2.5 10s2.7-5 7.5-5 7.5 5 7.5 5-2.7 5-7.5 5-7.5-5-7.5-5Z" stroke="currentColor" strokeWidth="1.4" /><circle cx="10" cy="10" r="2" stroke="currentColor" strokeWidth="1.4" /></svg>; }
function SparkleIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="m10 2 1.7 5.3L17 9l-5.3 1.7L10 16l-1.7-5.3L3 9l5.3-1.7L10 2Z" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round" /><path d="m16 13 .7 2.3L19 16l-2.3.7L16 19l-.7-2.3L13 16l2.3-.7L16 13Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>; }
function HandIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><path d="M6.5 10V5a1 1 0 0 1 2 0v4-5a1 1 0 0 1 2 0v5-4a1 1 0 0 1 2 0v5-2a1 1 0 0 1 2 0v5c0 3-2 5-5 5h-.5c-1.8 0-2.8-.8-3.7-2.1L3 13a1.3 1.3 0 0 1 2-1.6l1.5 1.4V10Z" stroke="currentColor" strokeWidth="1.2" strokeLinejoin="round" /></svg>; }
function InfoIcon() { return <svg viewBox="0 0 20 20" fill="none" aria-hidden="true"><circle cx="10" cy="10" r="7.5" stroke="currentColor" strokeWidth="1.4" /><path d="M10 9v4m0-6h.01" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" /></svg>; }
