"use client";
import { useEffect, useState, type ReactNode } from "react";
import Link from "next/link";
import { usePathname } from "next/navigation";
import { ShieldCheck } from "lucide-react";
import { BuildSignature } from "@/components/build-signature";
import { api, ApiError } from "@/lib/api";
export const strings = {
  skip: ["Skip to content", "Langsung ke konten"],
  navigation: ["Main navigation", "Navigasi utama"],
  confidential: ["Confidential reporting", "Pelaporan rahasia"],
  noAccount: ["No account needed", "Tidak perlu akun"],
  reportIntro: [
    "Share a concern at your own pace. Review your report and evidence before sharing them with the review team.",
    "Sampaikan kekhawatiran Anda sesuai kenyamanan Anda. Tinjau laporan dan bukti sebelum membagikannya kepada tim peninjau.",
  ],
  caseIntro: [
    "Use your saved case code and access secret to follow progress and speak privately with your review team.",
    "Gunakan kode laporan dan rahasia akses yang tersimpan untuk mengikuti perkembangan dan berbicara secara pribadi dengan tim peninjau.",
  ],
  staffAccess: ["Staff access", "Akses staf"],
  staffIntro: [
    "Sign in with your staff account. An authenticator or recovery code is required to continue.",
    "Masuk dengan akun staf Anda. Kode autentikator atau pemulihan diperlukan untuk melanjutkan.",
  ],
  previousPage: ["Previous page", "Halaman sebelumnya"],
  nextPage: ["Next page", "Halaman berikutnya"],
  what: ["More detail about what happened", "Detail tentang kejadian"],
  high: ["High", "Tinggi"],
  critical: ["Critical", "Kritis"],
  who: ["Who was involved?", "Siapa yang terlibat?"],
  when: ["When did it happen?", "Kapan kejadian terjadi?"],
  where: ["Where did it happen?", "Di mana kejadian terjadi?"],
  howKnown: ["How do you know?", "Bagaimana Anda mengetahuinya?"],
  impact: ["Impact or harm", "Dampak atau kerugian"],
  ongoing: ["Is it ongoing?", "Apakah masih berlangsung?"],
  home: ["Confidential reporting", "Pelaporan rahasia"],
  report: ["Create a report", "Buat laporan"],
  portal: ["Open my case", "Buka laporan saya"],
  staff: ["Staff portal", "Portal staf"],
  privacy: [
    "Contact information is optional and hidden from all staff. Details you share in your report may still identify you.",
    "Informasi kontak bersifat opsional dan disembunyikan dari semua staf. Isi laporan dapat mengungkapkan identitas Anda.",
  ],
  submit: ["Submit report", "Kirim laporan"],
  save: ["Save", "Simpan"],
  cancel: ["Cancel", "Batal"],
  signout: ["Sign out", "Keluar"],
  send: ["Send", "Kirim"],
  body: ["Message", "Pesan"],
  caseCode: ["Case code", "Kode laporan"],
  pin: ["Access secret", "Rahasia akses"],
  recovery: ["Recovery secret", "Rahasia pemulihan"],
  title: ["Title", "Judul"],
  summary: ["What happened?", "Apa yang terjadi?"],
  category: ["Category", "Kategori"],
  businessUnit: ["Business unit", "Unit bisnis"],
  sensitive: [
    "This concerns leadership or the usual review team. Use the independent review team.",
    "Laporan ini terkait pimpinan atau tim peninjau biasa. Gunakan tim peninjau independen.",
  ],
  policy: ["Reporting policy", "Kebijakan pelaporan"],
  notice: ["Privacy notice", "Pemberitahuan privasi"],
  review: [
    "I reviewed this content and removed details that could identify me.",
    "Saya telah meninjau isi ini dan menghapus detail yang dapat mengidentifikasi saya.",
  ],
  error: [
    "Unable to complete this request.",
    "Permintaan ini belum dapat diselesaikan.",
  ],
  loading: ["Loading…", "Memuat…"],
  verified: ["Contact verified", "Kontak terverifikasi"],
  verifyMeaning: [
    "Verification confirms control of your contact, not your legal identity. Staff see only verification status.",
    "Verifikasi memastikan kendali atas kontak Anda, bukan identitas hukum Anda. Staf hanya melihat status verifikasi.",
  ],
  contacts: ["Optional private contacts", "Kontak pribadi opsional"],
  destination: [
    "Email address or international phone number",
    "Alamat email atau nomor telepon internasional",
  ],
  notifications: [
    "Send generic notifications to this contact",
    "Kirim notifikasi umum ke kontak ini",
  ],
  otp: ["Send verification code", "Kirim kode verifikasi"],
  code: ["Verification code", "Kode verifikasi"],
  verify: ["Verify", "Verifikasi"],
  delete: ["Delete", "Hapus"],
  files: ["Evidence", "Bukti"],
  upload: ["Upload for scanning", "Unggah untuk pemindaian"],
  preview: ["View sanitized preview", "Lihat pratinjau yang disanitasi"],
  approve: [
    "Approve and share with reviewers",
    "Setujui dan bagikan dengan peninjau",
  ],
  redact: ["Apply permanent redactions", "Terapkan penyamaran permanen"],
  page: ["Page", "Halaman"],
  messages: ["Private conversation", "Percakapan pribadi"],
  reopen: ["Request reopening", "Minta dibuka kembali"],
  reason: ["Reason", "Alasan"],
  rotate: ["Replace saved access secrets", "Ganti rahasia akses tersimpan"],
  receipt: [
    "Save these secrets somewhere private. They are shown once. Contact verification cannot recover your case.",
    "Simpan rahasia ini di tempat pribadi. Rahasia hanya ditampilkan sekali. Verifikasi kontak tidak dapat memulihkan laporan.",
  ],
  saved: ["I have saved my secrets", "Saya telah menyimpan rahasia saya"],
  password: ["Password", "Kata sandi"],
  email: ["Email", "Email"],
  login: ["Sign in", "Masuk"],
  authenticator: [
    "Authenticator or recovery code",
    "Kode autentikator atau pemulihan",
  ],
  enroll: [
    "Scan this QR code with your authenticator app, then enter its six-digit code. You can also enter the setup key manually or open the app on this device.",
    "Pindai kode QR ini dengan aplikasi autentikator, lalu masukkan kode enam digitnya. Anda juga dapat memasukkan kunci penyiapan secara manual atau membuka aplikasi di perangkat ini.",
  ],
  mfaQr: ["Authenticator setup QR code", "Kode QR penyiapan autentikator"],
  setupKey: ["Manual setup key", "Kunci penyiapan manual"],
  recover: ["Recover with saved secret", "Pulihkan dengan rahasia tersimpan"],
  newPassword: [
    "New password (at least 15 characters)",
    "Kata sandi baru (minimal 15 karakter)",
  ],
  reset: ["Send password reset link", "Kirim tautan pengaturan kata sandi"],
  name: ["Name", "Nama"],
  role: ["Role", "Peran"],
  active: ["Active", "Aktif"],
  assign: ["Assign reviewer", "Tetapkan peninjau"],
  owner: ["Primary investigator", "Penyelidik utama"],
  state: ["Status", "Status"],
  recuse: ["Recuse myself", "Mengundurkan diri dari kasus"],
  notes: ["Internal notes", "Catatan internal"],
  findings: ["Findings", "Temuan"],
  tasks: ["Corrective actions", "Tindakan perbaikan"],
  due: ["Due date", "Tenggat"],
  complete: ["Mark complete", "Tandai selesai"],
  closure: ["Submit for closure review", "Ajukan penutupan untuk ditinjau"],
  outcome: ["Outcome", "Hasil"],
  rationale: ["Internal rationale", "Alasan internal"],
  explanation: ["Explanation for reporter", "Penjelasan untuk pelapor"],
  reviewClosure: ["Review closure", "Tinjau penutupan"],
  accept: ["Approve", "Setujui"],
  reject: ["Reject", "Tolak"],
  hold: ["Legal hold", "Penahanan hukum"],
  requestVerification: [
    "Request contact verification",
    "Minta verifikasi kontak",
  ],
  settings: ["Company settings", "Pengaturan perusahaan"],
  teams: ["Review teams", "Tim peninjau"],
  members: ["Members", "Anggota"],
  restricted: ["Independent restricted team", "Tim independen terbatas"],
  invite: ["Invite staff", "Undang staf"],
  audit: ["Audit history", "Riwayat audit"],
  operations: ["Delivery and retention", "Pengiriman dan retensi"],
  analytics: [
    "Aggregate statistics (groups below five are hidden)",
    "Statistik agregat (kelompok di bawah lima disembunyikan)",
  ],
  refresh: ["Refresh", "Muat ulang"],
  ai: ["Use optional assisted intake", "Gunakan panduan AI opsional"],
  aiConsent: [
    "I consent to MiniMax processing this private conversation. I will review the draft before submission.",
    "Saya menyetujui pemrosesan percakapan pribadi ini oleh MiniMax. Saya akan meninjau draf sebelum mengirim.",
  ],
  draft: ["Create an editable draft", "Buat draf yang dapat diedit"],
  withdraw: [
    "Withdraw AI consent and erase conversation",
    "Tarik persetujuan AI dan hapus percakapan",
  ],
  received: ["Received", "Diterima"],
  triage: ["Triage", "Peninjauan awal"],
  investigating: ["Investigating", "Diselidiki"],
  waiting_reporter: ["Waiting for reporter", "Menunggu pelapor"],
  closure_review: ["Closure review", "Peninjauan penutupan"],
  closed: ["Closed", "Ditutup"],
  analyst: ["Analyst", "Analis"],
  manager: ["Case manager", "Manajer kasus"],
  admin: ["System administrator", "Administrator sistem"],
  substantiated: ["Substantiated", "Terbukti"],
  partially_substantiated: ["Partially substantiated", "Sebagian terbukti"],
  unsubstantiated: ["Unsubstantiated", "Tidak terbukti"],
  out_of_scope: ["Out of scope", "Di luar cakupan"],
  duplicate: ["Duplicate", "Duplikat"],
  withdrawn: ["Withdrawn", "Ditarik"],
  pending: ["Pending", "Menunggu"],
  none: ["Unverified", "Belum diverifikasi"],
  quarantined: ["Scanning", "Dipindai"],
  published: ["Shared", "Dibagikan"],
  rejected: ["Rejected", "Ditolak"],
  overdue: ["Overdue", "Lewat tenggat"],
  unread: ["Unread", "Belum dibaca"],
  companyName: ["Company name", "Nama perusahaan"],
  acknowledgmentDays: [
    "Acknowledgment deadline (days)",
    "Tenggat konfirmasi (hari)",
  ],
  followupDays: ["Follow-up deadline (days)", "Tenggat tindak lanjut (hari)"],
  retention: ["Retention in days", "Retensi dalam hari"],
  cases: ["Cases", "Kasus"],
  evidence: ["Evidence", "Bukti"],
  transcripts: ["Private AI conversations", "Percakapan AI pribadi"],
  backups: ["Backups", "Cadangan"],
  defaultTeamId: ["Standard review team", "Tim peninjau biasa"],
  restrictedTeamId: ["Independent review team", "Tim peninjau independen"],
  aiEnabled: [
    "Enable optional MiniMax intake",
    "Aktifkan panduan MiniMax opsional",
  ],
  add: ["Add", "Tambah"],
  businessUnits: ["Business units", "Unit bisnis"],
  notificationTemplates: ["Generic notification text", "Teks notifikasi umum"],
  sessions: ["Signed-in sessions", "Sesi masuk"],
  revoke: ["Revoke", "Cabut"],
  copy: ["Copy secrets", "Salin rahasia"],
  download: ["Download receipt", "Unduh tanda terima"],
  done: ["Saved", "Tersimpan"],
  request: ["Request", "Permintaan"],
  verifyRequests: ["Verification requests", "Permintaan verifikasi"],
  check: ["Check", "Periksa"],
  severity: ["Severity", "Keparahan"],
  normal: ["Normal", "Normal"],
  menu: ["Menu", "Menu"],
  closeMenu: ["Close menu", "Tutup menu"],
  staffMembers: ["Staff", "Staf"],
  statistics: ["Statistics", "Statistik"],
  account: ["Account", "Akun"],
  overview: ["Overview", "Ringkasan"],
  investigation: ["Investigation", "Penyelidikan"],
  closureMenu: ["Closure & legal hold", "Penutupan & penahanan hukum"],
  caseSection: ["Case section", "Bagian kasus"],
  accessDenied: [
    "You do not have access to this page",
    "Anda tidak memiliki akses ke halaman ini",
  ],
  returnToWork: ["Return to workspace", "Kembali ke ruang kerja"],
  retryConnection: [
    "Check your connection and reload to try again.",
    "Periksa koneksi Anda dan muat ulang untuk mencoba lagi.",
  ],
  discardDraft: [
    "Discard unsaved changes",
    "Buang perubahan yang belum disimpan",
  ],
  noCases: [
    "No cases match this filter.",
    "Tidak ada kasus yang sesuai filter ini.",
  ],
  unavailableCase: [
    "This case is unavailable or you do not have access.",
    "Kasus ini tidak tersedia atau Anda tidak memiliki akses.",
  ],
  company: ["Company", "Perusahaan"],
  policies: ["Policies and notification text", "Kebijakan dan teks notifikasi"],
  categoriesUnits: [
    "Categories and business units",
    "Kategori dan unit bisnis",
  ],
  routingDeadlines: ["Routing and deadlines", "Perutean dan tenggat"],
  assistedIntake: ["Assisted intake", "Panduan pelaporan"],
  policyHistory: ["Policy history", "Riwayat kebijakan"],
  savedChanges: ["Changes saved", "Perubahan tersimpan"],
  noEvidence: ["No shared evidence yet.", "Belum ada bukti yang dibagikan."],
} satisfies Record<string, readonly [string, string]>;
export type Lang = "en" | "id";
export function useLanguage() {
  const [lang, setLang] = useState<Lang>("en");
  useEffect(() => {
    const l = localStorage.getItem("wb_language");
    if (l === "id") setLang("id");
  }, []);
  useEffect(() => {
    document.documentElement.lang = lang;
  }, [lang]);
  return {
    lang,
    setLang: (v: Lang) => {
      localStorage.setItem("wb_language", v);
      setLang(v);
    },
    t: (key: string) =>
      strings[key as keyof typeof strings]?.[lang === "id" ? 1 : 0] ??
      key.replaceAll("_", " "),
  };
}
export function Shell({
  children,
  language,
}: {
  children: ReactNode;
  language: ReturnType<typeof useLanguage>;
}) {
  const { lang, setLang, t } = language;
  const pathname = usePathname();
  const links = [
    { href: "/report", key: "report" },
    { href: "/case", key: "portal" },
    { href: "/staff", key: "staff" },
  ];
  return (
    <div className={`suite${pathname === "/staff" ? " suite-workspace" : ""}`}>
      <a className="skip-link" href="#main-content">
        {t("skip")}
      </a>
      <header className="suite-header">
        <div className="brand-lockup">
          <Link className="wordmark" href="/">
            Speak Up
          </Link>
          <span className="brand-caption">Lixionary</span>
        </div>
        <nav aria-label={t("navigation")}>
          {links.map(({ href, key }) => (
            <Link
              key={href}
              href={href}
              aria-current={
                pathname === href || pathname.startsWith(`${href}/`)
                  ? "page"
                  : undefined
              }
            >
              {t(key)}
            </Link>
          ))}
          <select
            aria-label="Language"
            value={lang}
            onChange={(e) => setLang(e.target.value as Lang)}
          >
            <option value="en">English</option>
            <option value="id">Bahasa Indonesia</option>
          </select>
        </nav>
      </header>
      <main
        id="main-content"
        tabIndex={-1}
        className="suite-main suite-content"
      >
        {children}
      </main>
      <footer className="suite-footer">
        <span>
          <ShieldCheck size={16} aria-hidden="true" />
          {t("confidential")}
        </span>
        <span>
          Speak Up · Lixionary · <BuildSignature />
        </span>
      </footer>
    </div>
  );
}

export function StatusBadge({
  state,
  children,
}: {
  state: string;
  children: ReactNode;
}) {
  const tone = ["overdue", "rejected", "hold", "critical"].includes(state)
    ? "danger"
    : [
          "pending",
          "quarantined",
          "waiting_reporter",
          "closure_review",
          "high",
        ].includes(state)
      ? "warn"
      : ["closed", "verified", "published", "substantiated"].includes(state)
        ? "ok"
        : ["received", "triage", "investigating", "unread"].includes(state)
          ? "info"
          : ["admin", "manager", "analyst"].includes(state)
            ? "accent"
            : "neutral";
  return <span className={`badge badge-${tone}`}>{children}</span>;
}
export function Field({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label>
      {label}
      <input {...props} />
    </label>
  );
}
export function Text({
  label,
  ...props
}: React.TextareaHTMLAttributes<HTMLTextAreaElement> & { label: string }) {
  return (
    <label>
      {label}
      <textarea rows={4} {...props} />
    </label>
  );
}
export function Check({
  label,
  ...props
}: React.InputHTMLAttributes<HTMLInputElement> & { label: string }) {
  return (
    <label className="check">
      <input type="checkbox" {...props} />
      <span>{label}</span>
    </label>
  );
}
export function Select({
  label,
  children,
  ...props
}: React.SelectHTMLAttributes<HTMLSelectElement> & { label: string }) {
  return (
    <label>
      {label}
      <select {...props}>{children}</select>
    </label>
  );
}
export function ErrorBox({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="error">
      {error}
    </p>
  ) : null;
}
const errors: Record<string, [string, string]> = {
  policy_changed: [
    "The company policy changed. Review it again before continuing; your report text is kept on this page.",
    "Kebijakan perusahaan berubah. Tinjau kembali sebelum melanjutkan; teks laporan Anda tetap ada di halaman ini.",
  ],
  preview_changed: [
    "This preview changed. Open it again and review the current version.",
    "Pratinjau berubah. Buka kembali dan tinjau versi terbaru.",
  ],
  case_file_limit: [
    "This case has reached its file or storage limit.",
    "Kasus ini telah mencapai batas file atau penyimpanan.",
  ],
  submission_expired: [
    "This saved submission has expired. Start a new report.",
    "Laporan tersimpan ini telah kedaluwarsa. Buat laporan baru.",
  ],
  sms_unavailable: [
    "Phone verification is currently unavailable. You can use email or continue anonymously.",
    "Verifikasi telepon belum tersedia. Anda dapat menggunakan email atau tetap anonim.",
  ],
  email_unavailable: [
    "Email verification is currently unavailable. You can continue anonymously.",
    "Verifikasi email belum tersedia. Anda dapat tetap anonim.",
  ],
  ai_disabled: [
    "Assisted intake is unavailable. Use the report form below.",
    "Panduan AI belum tersedia. Gunakan formulir laporan di bawah.",
  ],
  invalid_code: [
    "Invalid or already used code. Wait for a new authenticator code or use a saved recovery code.",
    "Kode salah atau sudah digunakan. Tunggu kode autentikator baru atau gunakan kode pemulihan tersimpan.",
  ],
  legal_hold: [
    "These records are currently subject to a legal hold.",
    "Catatan ini sedang dalam penahanan hukum.",
  ],
  retention_in_progress: [
    "Cleanup is in progress. Try setting the hold again in two minutes.",
    "Pembersihan sedang berlangsung. Coba penahanan lagi dalam dua menit.",
  ],
  unauthorized: [
    "Your session expired. Sign in again.",
    "Sesi Anda berakhir. Silakan masuk kembali.",
  ],
  mfa_required: [
    "Authenticator verification is required.",
    "Verifikasi autentikator diperlukan.",
  ],
  invalid_credentials: [
    "Check your code and saved secret.",
    "Periksa kode dan rahasia tersimpan Anda.",
  ],
  invalid_or_expired_code: [
    "The verification code is incorrect or expired.",
    "Kode verifikasi salah atau kedaluwarsa.",
  ],
  rate_limit: [
    "Too many attempts. Please wait and try again.",
    "Terlalu banyak percobaan. Tunggu sebelum mencoba lagi.",
  ],
  otp_rate_limit: [
    "Wait before requesting or trying another code.",
    "Tunggu sebelum meminta atau mencoba kode lain.",
  ],
  configuration_incomplete: [
    "Company setup is incomplete.",
    "Pengaturan perusahaan belum lengkap.",
  ],
  reviewer_capacity: [
    "Each review team needs two active managers.",
    "Setiap tim peninjau memerlukan dua manajer aktif.",
  ],
  team_overlap: [
    "The restricted team must have independent members.",
    "Anggota tim terbatas harus independen.",
  ],
  independent_review_required: [
    "A different case manager must approve closure.",
    "Manajer kasus yang berbeda harus menyetujui penutupan.",
  ],
  open_corrective_actions: [
    "Complete corrective actions before requesting closure.",
    "Selesaikan tindakan perbaikan sebelum mengajukan penutupan.",
  ],
  not_found: [
    "This item is unavailable or you do not have access.",
    "Item tidak tersedia atau Anda tidak memiliki akses.",
  ],
  invalid_transition: [
    "This status change is unavailable.",
    "Perubahan status ini tidak tersedia.",
  ],
  case_closed: [
    "This case is closed. Request reopening to continue.",
    "Kasus ditutup. Minta dibuka kembali untuk melanjutkan.",
  ],
};
export function friendly(e: unknown, lang: Lang) {
  if (e instanceof ApiError) {
    if (e.code === "validation_error")
      return e.issues.length
        ? e.issues.map((i) => `${i.path}: ${i.message}`).join(" · ")
        : lang === "id"
          ? "Periksa kolom yang wajib diisi."
          : "Check the required fields.";
    return (
      errors[e.code]?.[lang === "id" ? 1 : 0] ??
      (lang === "id"
        ? "Permintaan gagal. Coba lagi."
        : "The request failed. Try again.")
    );
  }
  return lang === "id"
    ? "Tidak dapat terhubung. Periksa koneksi Anda."
    : "Unable to connect. Check your connection.";
}
export function useAction(lang: Lang) {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  async function run(fn: () => Promise<void>) {
    setError("");
    setBusy(true);
    try {
      await fn();
    } catch (e) {
      setError(friendly(e, lang));
    } finally {
      setBusy(false);
    }
  }
  return { error, busy, run, setError };
}
export function usePoll(fn: () => Promise<void>) {
  useEffect(() => {
    const timer = setInterval(() => {
      if (document.visibilityState === "visible") void fn().catch(() => {});
    }, 30000);
    return () => clearInterval(timer);
  }, [fn]);
}
export async function privateApi<T>(
  path: string,
  opts: Parameters<typeof api>[1] = {},
) {
  const { capability } = await api<{ capability: string }>(
    "/api/reporter/capability",
    { method: "POST", body: {} },
  );
  return api<T>(`/privacy/reporter${path}`, {
    ...opts,
    headers: { ...opts.headers, Authorization: `Bearer ${capability}` },
  });
}
export function Receipt({
  receipt,
  onDone,
  t,
}: {
  receipt: { caseCode: string; pin: string; recoverySecret: string };
  onDone: () => void;
  t: (s: string) => string;
}) {
  const [saved, setSaved] = useState(false);
  const text = `${receipt.caseCode}\nAccess secret: ${receipt.pin}\nRecovery secret: ${receipt.recoverySecret}\n`;
  return (
    <section>
      <h1>{receipt.caseCode}</h1>
      <p>{t("receipt")}</p>
      <dl>
        <dt>{t("pin")}</dt>
        <dd className="secret">{receipt.pin}</dd>
        <dt>{t("recovery")}</dt>
        <dd className="secret">{receipt.recoverySecret}</dd>
      </dl>
      <button onClick={() => void navigator.clipboard.writeText(text)}>
        {t("copy")}
      </button>{" "}
      <button
        onClick={() => {
          const url = URL.createObjectURL(
            new Blob([text], { type: "text/plain" }),
          );
          const a = document.createElement("a");
          a.href = url;
          a.download = "private-report-receipt.txt";
          a.click();
          URL.revokeObjectURL(url);
        }}
      >
        {t("download")}
      </button>
      <Check
        label={t("saved")}
        checked={saved}
        onChange={(e) => setSaved(e.target.checked)}
      />
      <button disabled={!saved} onClick={onDone}>
        {t("portal")}
      </button>
    </section>
  );
}
