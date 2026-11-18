import { ShieldCheck } from "lucide-react";

export function evaluatePasswordStrength(password = "") {
  const pw = String(password || "");
  const hasMinLen = pw.length >= 6;
  const hasGoodLen = pw.length >= 10;
  const hasUpper = /[A-Z]/.test(pw);
  const hasLower = /[a-z]/.test(pw);
  const hasDigit = /\d/.test(pw);
  const hasSymbol = /[^A-Za-z0-9]/.test(pw);

  if (!pw) {
    return {
      score: 0,
      label: "Belum diisi",
      barColor: "bg-slate-200 dark:bg-slate-700",
      textColor: "text-sub",
      checks: { hasMinLen, hasUpper, hasLower, hasDigit, hasSymbol }
    };
  }

  let points = 0;
  if (hasMinLen) points += 1;
  if (hasGoodLen) points += 1;
  if (hasUpper && hasLower) points += 1;
  if (hasDigit) points += 1;
  if (hasSymbol) points += 1;

  if (!hasMinLen || points <= 1) {
    return {
      score: 1,
      label: hasMinLen ? "Lemah" : "Min. 6 Karakter",
      barColor: "bg-rose-500",
      textColor: "text-rose-600 dark:text-rose-400",
      checks: { hasMinLen, hasUpper, hasLower, hasDigit, hasSymbol }
    };
  }
  if (points === 2) {
    return {
      score: 2,
      label: "Cukup",
      barColor: "bg-amber-500",
      textColor: "text-amber-600 dark:text-amber-400",
      checks: { hasMinLen, hasUpper, hasLower, hasDigit, hasSymbol }
    };
  }
  if (points === 3 || points === 4) {
    return {
      score: 3,
      label: "Kuat",
      barColor: "bg-sky-500",
      textColor: "text-sky-600 dark:text-sky-400",
      checks: { hasMinLen, hasUpper, hasLower, hasDigit, hasSymbol }
    };
  }
  return {
    score: 4,
    label: "Sangat Kuat",
    barColor: "bg-emerald-500",
    textColor: "text-emerald-600 dark:text-emerald-400",
    checks: { hasMinLen, hasUpper, hasLower, hasDigit, hasSymbol }
  };
}

export function PasswordStrengthMeter({ password }) {
  if (!password) return null;
  const info = evaluatePasswordStrength(password);

  return (
    <div className="mt-1.5 space-y-1.5" data-testid="password-strength-meter">
      <div className="flex items-center justify-between text-[11px]">
        <span className="flex items-center gap-1 text-sub font-medium">
          <ShieldCheck size={12} className="text-emerald-600 dark:text-emerald-400" />
          Kekuatan Password:
        </span>
        <span className={`font-bold ${info.textColor}`}>{info.label}</span>
      </div>
      <div className="grid grid-cols-4 gap-1">
        {[1, 2, 3, 4].map((step) => (
          <div
            key={step}
            className={`h-1.5 rounded-full transition-colors duration-200 ${
              info.score >= step ? info.barColor : "bg-slate-200 dark:bg-slate-700"
            }`}
          />
        ))}
      </div>
      <div className="flex flex-wrap gap-x-2.5 gap-y-0.5 text-[10px] text-sub">
        <span className={info.checks.hasMinLen ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""}>
          {info.checks.hasMinLen ? "✓" : "•"} Min. 6 karakter
        </span>
        <span className={info.checks.hasUpper && info.checks.hasLower ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""}>
          {info.checks.hasUpper && info.checks.hasLower ? "✓" : "•"} Huruf besar & kecil
        </span>
        <span className={info.checks.hasDigit ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""}>
          {info.checks.hasDigit ? "✓" : "•"} Angka
        </span>
        <span className={info.checks.hasSymbol ? "text-emerald-600 dark:text-emerald-400 font-semibold" : ""}>
          {info.checks.hasSymbol ? "✓" : "•"} Simbol
        </span>
      </div>
    </div>
  );
}
