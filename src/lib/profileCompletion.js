export function getProfileCompletion(user) {
  if (!user || typeof user !== "object") {
    return {
      percent: 0,
      filledCount: 0,
      totalCount: 9,
      missingFields: [],
      isVerified: false,
    };
  }

  const isAdminRole = ["super_admin", "workspace_admin"].includes(user.role);
  const isCustomMode = user.work_mode === "Custom" || user.work_mode === "Kustom";
  const hasSkills = Array.isArray(user.skills)
    ? user.skills.filter((s) => String(s || "").trim()).length > 0
    : typeof user.skillsText === "string"
    ? user.skillsText.split(",").some((s) => s.trim().length > 0)
    : false;

  const checks = [
    { key: "name", label: "Nama Lengkap", ok: Boolean(String(user.name || "").trim()) },
    { key: "phone", label: "No. Telepon", ok: Boolean(String(user.phone || "").trim()) },
    { key: "employee_id", label: "ID Employee", ok: Boolean(String(user.employee_id || "").trim()) },
    { key: "employment_status", label: "Status Kepegawaian", ok: Boolean(String(user.employment_status || "").trim()) },
    { key: "join_date", label: "Tanggal Bergabung", ok: Boolean(String(user.join_date || "").trim()) },
    ...(isAdminRole
      ? [
          { key: "job_title", label: "Jabatan", ok: Boolean(String(user.job_title || "").trim()) },
          { key: "department", label: "Divisi", ok: Boolean(String(user.department || "").trim()) },
          { key: "team", label: "Tim", ok: Boolean(String(user.team || "").trim()) },
        ]
      : []),
    { key: "work_mode", label: "Mode Kerja", ok: Boolean(String(user.work_mode || "").trim()) },
    ...(isCustomMode
      ? [{ key: "custom_location", label: "Lokasi Kustom", ok: Boolean(String(user.custom_location || "").trim()) }]
      : []),
    { key: "city", label: "Kota", ok: Boolean(String(user.city || "").trim()) },
    { key: "office", label: "Kantor", ok: Boolean(String(user.office || "").trim()) },
    { key: "location_status", label: "Status Lokasi", ok: Boolean(String(user.location_status || "").trim()) },
    { key: "skills", label: "Keahlian", ok: hasSkills },
    { key: "bio", label: "Biodata", ok: Boolean(String(user.bio || "").trim()) },
  ];

  const totalCount = checks.length;
  const filledCount = checks.filter((c) => c.ok).length;
  const missingFields = checks.filter((c) => !c.ok).map((c) => c.label);
  const percent = totalCount > 0 ? Math.round((filledCount / totalCount) * 100) : 0;

  return {
    percent,
    filledCount,
    totalCount,
    missingFields,
    isVerified: filledCount === totalCount && totalCount > 0,
  };
}
