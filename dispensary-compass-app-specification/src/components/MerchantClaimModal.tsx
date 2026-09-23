import { useState } from "react";
import { Building2, CheckCircle2, Send, ShieldCheck, X } from "lucide-react";
import type { Dispensary } from "../lib/geo";
import { cn } from "../utils/cn";

interface Props {
  dark: boolean;
  target: Dispensary;
  apiOrigin: string;
  onClose: () => void;
}

type SubmitState = "idle" | "submitting" | "success" | "error";

export default function MerchantClaimModal({ dark, target, apiOrigin, onClose }: Props) {
  const [state, setState] = useState<SubmitState>("idle");
  const [error, setError] = useState("");
  const [form, setForm] = useState({
    claimantName: "",
    businessEmail: "",
    claimantRole: "",
    businessWebsite: target.website ?? "",
    businessPhone: target.phone ?? "",
    notes: "",
    company: "",
  });

  const field = (key: keyof typeof form) => ({
    value: form[key],
    onChange: (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) =>
      setForm((prev) => ({ ...prev, [key]: e.target.value })),
  });

  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (state === "submitting") return;
    setState("submitting");
    setError("");

    try {
      const response = await fetch(`${apiOrigin}/api/claims`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          osmType: target.osmType,
          osmId: target.osmId,
          locationName: target.name?.trim() || "Cannabis dispensary",
          latitude: target.latitude,
          longitude: target.longitude,
          ...form,
        }),
      });

      if (response.status === 409) {
        setError("A claim for this business and email is already under review.");
        setState("error");
        return;
      }
      if (!response.ok) throw new Error(`Claim request failed (${response.status})`);
      setState("success");
    } catch {
      setError("We couldn't submit this claim right now. Please try again.");
      setState("error");
    }
  };

  return (
    <div className="fixed inset-0 z-[1000] flex items-end justify-center bg-black/65 p-3 backdrop-blur-sm sm:items-center" role="dialog" aria-modal="true" aria-label="Claim this business">
      <div className={cn("max-h-[92vh] w-full max-w-xl overflow-y-auto rounded-[1.75rem] border shadow-2xl", dark ? "border-white/10 bg-[#121612] text-white" : "border-black/10 bg-[#faf7ef] text-black")}>
        <div className="flex items-start justify-between gap-4 border-b border-black/10 p-5 dark:border-white/10">
          <div>
            <div className={cn("font-mono2 text-[10.5px] font-bold tracking-[0.2em]", dark ? "text-emerald-300" : "text-emerald-800")}>MERCHANT CLAIM · FOUNDING ACCESS</div>
            <h2 className="font-display mt-1 text-2xl font-black">Claim {target.name?.trim() || "this location"}</h2>
            <p className={cn("mt-1 text-sm", dark ? "text-white/55" : "text-black/55")}>Verification is manual during the pilot. Claiming does not change geographic ranking.</p>
          </div>
          <button onClick={onClose} className={cn("flex h-9 w-9 shrink-0 items-center justify-center rounded-full", dark ? "hover:bg-white/10" : "hover:bg-black/5")} aria-label="Close claim form">
            <X className="h-4 w-4" />
          </button>
        </div>

        {state === "success" ? (
          <div className="p-7 text-center">
            <CheckCircle2 className="mx-auto h-12 w-12 text-emerald-500" />
            <h3 className="font-display mt-4 text-3xl font-black">Claim received.</h3>
            <p className={cn("mx-auto mt-2 max-w-md text-sm leading-relaxed", dark ? "text-white/60" : "text-black/60")}>Your request is queued for manual verification. No payment is required during the founding pilot.</p>
            <button onClick={onClose} className={cn("mt-6 rounded-2xl px-5 py-3 text-sm font-extrabold", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>Done</button>
          </div>
        ) : (
          <form onSubmit={submit} className="space-y-4 p-5">
            <div className={cn("flex gap-3 rounded-2xl border p-4 text-sm", dark ? "border-white/10 bg-white/[0.03]" : "border-black/10 bg-white/70")}>
              <Building2 className="mt-0.5 h-5 w-5 shrink-0 text-emerald-500" />
              <div>
                <div className="font-extrabold">{target.name?.trim() || "Cannabis dispensary"}</div>
                <div className={dark ? "text-white/50" : "text-black/50"}>{target.address ?? `${target.latitude.toFixed(5)}, ${target.longitude.toFixed(5)}`}</div>
                <div className={cn("mt-1 font-mono2 text-[10px]", dark ? "text-white/30" : "text-black/35")}>{target.osmType}/{target.osmId}</div>
              </div>
            </div>

            <div className="grid gap-3 sm:grid-cols-2">
              <ClaimField label="YOUR NAME" required dark={dark}><input required maxLength={120} {...field("claimantName")} /></ClaimField>
              <ClaimField label="BUSINESS EMAIL" required dark={dark}><input required type="email" maxLength={200} {...field("businessEmail")} /></ClaimField>
              <ClaimField label="YOUR ROLE" required dark={dark}><input required maxLength={120} placeholder="Owner, manager, marketing…" {...field("claimantRole")} /></ClaimField>
              <ClaimField label="BUSINESS PHONE" dark={dark}><input maxLength={80} {...field("businessPhone")} /></ClaimField>
            </div>

            <ClaimField label="BUSINESS WEBSITE" dark={dark}><input type="url" maxLength={300} placeholder="https://" {...field("businessWebsite")} /></ClaimField>
            <ClaimField label="NOTES" dark={dark}><textarea rows={3} maxLength={1000} placeholder="Anything that will help us verify your relationship to this location." {...field("notes")} /></ClaimField>

            <div className="hidden" aria-hidden="true">
              <label>Company<input tabIndex={-1} autoComplete="off" {...field("company")} /></label>
            </div>

            {error && <div className="rounded-xl bg-rose-500/10 px-3 py-2 text-sm text-rose-500">{error}</div>}

            <div className={cn("flex gap-2 rounded-2xl border p-3 text-xs leading-relaxed", dark ? "border-white/10 text-white/45" : "border-black/10 text-black/50")}>
              <ShieldCheck className="h-4 w-4 shrink-0 text-emerald-500" />
              <span>Claim data is used for business verification and pilot onboarding. It does not affect who COMPASS identifies as geographically nearest.</span>
            </div>

            <button disabled={state === "submitting"} className={cn("flex w-full items-center justify-center gap-2 rounded-2xl px-5 py-3.5 text-sm font-extrabold disabled:opacity-60", dark ? "bg-emerald-400 text-emerald-950" : "bg-emerald-800 text-white")}>
              <Send className="h-4 w-4" /> {state === "submitting" ? "Submitting…" : "Submit claim"}
            </button>
          </form>
        )}
      </div>
    </div>
  );
}

function ClaimField({ label, required, dark, children }: { label: string; required?: boolean; dark: boolean; children: React.ReactElement<{ className?: string }> }) {
  const element = children as React.ReactElement<{ className?: string }>;
  return (
    <label className="block">
      <span className={cn("font-mono2 text-[10px] font-bold tracking-[0.16em]", dark ? "text-white/40" : "text-black/45")}>{label}{required ? " *" : ""}</span>
      <div className={cn("mt-1 [&>input]:w-full [&>input]:rounded-xl [&>input]:border [&>input]:bg-transparent [&>input]:p-3 [&>input]:text-sm [&>textarea]:w-full [&>textarea]:rounded-xl [&>textarea]:border [&>textarea]:bg-transparent [&>textarea]:p-3 [&>textarea]:text-sm", dark ? "[&>input]:border-white/10 [&>textarea]:border-white/10" : "[&>input]:border-black/10 [&>textarea]:border-black/10")}>{element}</div>
    </label>
  );
}
