import { useEffect, useRef, useState, type ChangeEvent, type FormEvent, type ReactElement } from "react";
import { Building2, CheckCircle2, Send, ShieldCheck, X } from "lucide-react";
import type { Dispensary } from "../lib/geo";
import { cn } from "../utils/cn";

interface Props { dark: boolean; target: Dispensary; apiOrigin: string; onClose: () => void }
type SubmitState = "idle" | "submitting" | "success" | "error";
const NOTICE_VERSION = "merchant-privacy-v2";

export default function MerchantClaimModal({ dark, target, apiOrigin, onClose }: Props) {
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState("");
  const [consent, setConsent] = useState(false);
  const [receipt, setReceipt] = useState("");
  const panel = useRef<HTMLDivElement>(null);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  const request = useRef<AbortController | null>(null);
  const attempt = useRef<{ body: string; id: string } | null>(null);
  const [form, setForm] = useState({ claimantName: "", businessEmail: "", claimantRole: "",
    businessWebsite: target.website ?? "", businessPhone: target.phone ?? "", notes: "", company: "" });

  useEffect(() => {
    const previous = document.activeElement as HTMLElement | null;
    panel.current?.focus();
    const keyboard = (event: KeyboardEvent) => {
      if (event.key === "Escape") { event.preventDefault(); closeRef.current(); }
      if (event.key !== "Tab" || !panel.current) return;
      const nodes = Array.from(panel.current.querySelectorAll<HTMLElement>('button:not([disabled]), input:not([disabled]):not([tabindex="-1"]), textarea, a[href]'))
        .filter(node => node.getClientRects().length > 0);
      const first = nodes[0], last = nodes[nodes.length - 1];
      if (!first) { event.preventDefault(); return; }
      if (event.shiftKey && (document.activeElement === first || document.activeElement === panel.current)) { event.preventDefault(); last.focus(); }
      else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus(); }
    };
    document.addEventListener("keydown", keyboard);
    return () => { request.current?.abort(); document.removeEventListener("keydown", keyboard); previous?.focus(); };
  }, []);

  const field = (key: keyof typeof form) => ({ value: form[key],
    onChange: (e: ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setForm(prev => ({ ...prev, [key]: e.target.value })) });

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (state === "submitting" || !consent) return;
    setState("submitting"); setError("");
    const body = JSON.stringify({ osmType: target.osmType, osmId: target.osmId,
      locationName: target.name?.trim() || "Cannabis dispensary", latitude: target.latitude,
      longitude: target.longitude, ...form, verificationConsent: true, noticeVersion: NOTICE_VERSION });
    // Reuse the same key after an uncertain network result; edits get a new key.
    if (attempt.current?.body !== body) attempt.current = { body, id: crypto.randomUUID() };
    const ctrl = new AbortController(); request.current = ctrl;
    const timer = window.setTimeout(() => ctrl.abort(), 15000);
    try {
      const response = await fetch(`${apiOrigin}/api/claims`, { method: "POST",
        headers: { "Content-Type": "application/json", "Idempotency-Key": attempt.current.id },
        body, signal: ctrl.signal });
      if (response.status === 409) throw new Error("A claim for this business and email already exists. It has not been verified by this submission.");
      if (response.status === 429) throw new Error("The submission limit has been reached. Please try again later.");
      if (!response.ok) throw new Error("The claim service is not available. Retry without editing the form to reuse this submission safely.");
      const data = await response.json();
      if (data?.accepted !== true || data?.status !== "pending" || typeof data?.claimId !== "string" ||
          !/^[0-9a-f-]{36}$/i.test(data.claimId)) throw new Error("No saved-claim receipt was returned. Please retry this submission.");
      setReceipt(data.claimId); setState("success");
    } catch (err) {
      setError(ctrl.signal.aborted ? "The request timed out. Its outcome is uncertain; retry unchanged to avoid a duplicate." :
        err instanceof Error ? err.message : "The claim could not be submitted.");
      setState("error");
    } finally { window.clearTimeout(timer); }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center">
      <div ref={panel} tabIndex={-1} role="dialog" aria-modal="true" aria-labelledby="claim-title"
        className={cn("max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[1.75rem] border shadow-2xl", dark ? "border-white/10 bg-[#121612] text-white" : "border-black/10 bg-[#faf7ef] text-black")}>
        <div className="flex items-start justify-between gap-4 border-b border-black/10 p-5 dark:border-white/10">
          <div>
            <div className={cn("font-mono2 text-[10.5px] font-bold tracking-[0.2em]", dark ? "text-emerald-300" : "text-emerald-800")}>MERCHANT CLAIM · FOUNDING ACCESS</div>
            <h2 id="claim-title" className="font-display mt-1 text-2xl font-black">Claim {target.name?.trim() || "this location"}</h2>
            <p className="mt-1 text-sm opacity-70">Manual review is required. A submission does not verify ownership or change geographic ranking.</p>
          </div>
          <button type="button" onClick={onClose} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full" aria-label="Close claim form"><X className="h-4 w-4" /></button>
        </div>
        {state === "success" ? (
          <div className="p-7 text-center" role="status">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h3 className="font-display mt-4 text-3xl font-black">Claim received.</h3>
            <p className="mt-2 text-sm opacity-70">Your saved request is pending manual review. No payment was taken and no verification badge has been issued.</p>
            <p className="mt-3 break-all font-mono2 text-xs">Receipt: {receipt}</p>
            <button type="button" onClick={onClose} className={cn("mt-6 rounded-2xl px-5 py-3 font-extrabold", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-5">
            <div className="flex gap-3 rounded-2xl border p-4 text-sm">
              <Building2 className="h-5 w-5 shrink-0 text-emerald-500" />
              <div><strong>{target.name?.trim() || "Cannabis dispensary"}</strong>
                <p className="opacity-70">{target.address ?? `${target.latitude.toFixed(5)}, ${target.longitude.toFixed(5)}`}</p>
                <p className="font-mono2 text-xs opacity-60">{target.osmType}/{target.osmId}</p></div>
            </div>
            <div className="grid gap-3 sm:grid-cols-2">
              <ClaimField label="YOUR NAME" required dark={dark}><input required autoComplete="name" maxLength={120} {...field("claimantName")} /></ClaimField>
              <ClaimField label="BUSINESS EMAIL" required dark={dark}><input required type="email" autoComplete="email" maxLength={200} {...field("businessEmail")} /></ClaimField>
              <ClaimField label="YOUR ROLE" required dark={dark}><input required maxLength={120} {...field("claimantRole")} /></ClaimField>
              <ClaimField label="BUSINESS PHONE" dark={dark}><input type="tel" maxLength={80} {...field("businessPhone")} /></ClaimField>
            </div>
            <ClaimField label="BUSINESS WEBSITE" dark={dark}><input type="url" maxLength={300} placeholder="https://" {...field("businessWebsite")} /></ClaimField>
            <ClaimField label="NOTES — NO ID DOCUMENTS OR SENSITIVE PERSONAL DATA" dark={dark}><textarea rows={3} maxLength={1000} {...field("notes")} /></ClaimField>
            <div className="hidden" aria-hidden="true"><label>Company<input tabIndex={-1} autoComplete="off" {...field("company")} /></label></div>
            <label className="flex items-start gap-3 rounded-xl border p-3 text-sm">
              <input type="checkbox" required checked={consent} onChange={e => setConsent(e.target.checked)} className="mt-1 h-5 w-5 shrink-0" />
              <span>I am authorized to represent this business. I agree to the use of these contact details for verification as described in the <a href="./privacy.html" target="_blank" rel="noreferrer" className="underline">privacy notice</a>.</span>
            </label>
            {error && <div role="alert" className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{error}</div>}
            <div className="flex gap-2 text-xs opacity-70"><ShieldCheck className="h-4 w-4 shrink-0" /><span>Stored server-side in Neon only after a successful submission. No payment or geographic-ranking advantage.</span></div>
            <button disabled={state === "submitting" || !consent} className={cn("flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-extrabold disabled:opacity-60", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>
              <Send className="h-4 w-4" />{state === "submitting" ? "Submitting…" : "Submit claim"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}
function ClaimField({ label, required, dark, children }: { label: string; required?: boolean; dark: boolean; children: ReactElement }) {
  return <label className="block"><span className="font-mono2 text-[10px] font-bold tracking-[0.16em] opacity-70">{label}{required ? " *" : ""}</span>
    <div className={cn("mt-1 [&>input]:w-full [&>input]:rounded-xl [&>input]:border [&>input]:bg-transparent [&>input]:p-3 [&>input]:text-sm [&>textarea]:w-full [&>textarea]:rounded-xl [&>textarea]:border [&>textarea]:bg-transparent [&>textarea]:p-3 [&>textarea]:text-sm", dark ? "[&>input]:border-white/10 [&>textarea]:border-white/10" : "[&>input]:border-black/10 [&>textarea]:border-black/10")}>{children}</div>
  </label>;
}
