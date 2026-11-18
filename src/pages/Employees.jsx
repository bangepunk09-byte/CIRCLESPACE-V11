import { useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Users, Search, MessageCircle, MapPin, Briefcase, Mail } from "lucide-react";
import { toast } from "sonner";
import { useApp } from "../context/AppContext";
import { api, errMsg } from "../lib/api";
import { Avatar, PageHeader, Empty, getAvailabilityStatusMeta, VerifiedBadge } from "../components/common";

export default function Employees() {
  const { users, online, t } = useApp();
  const [q, setQ] = useState("");
  const [sel, setSel] = useState([]);
  const dmBusyRef = useRef(false);
  const navigate = useNavigate();

  const humanUsers = useMemo(
    () => users.filter((u) => !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"),
    [users]
  );
  const divisions = useMemo(
    () => [...new Set(humanUsers.map((u) => u.department || "Lainnya"))].sort(),
    [humanUsers]
  );
  const list = useMemo(
    () =>
      humanUsers.filter(
        (u) =>
          (!sel.length || sel.includes(u.department || "Lainnya")) &&
          `${u.name} ${u.job_title || ""} ${u.email || ""} ${u.department || ""}`
            .toLowerCase()
            .includes(q.toLowerCase())
      ),
    [humanUsers, sel, q]
  );

  const toggle = (d) => setSel(sel.includes(d) ? sel.filter((x) => x !== d) : [...sel, d]);
  const dm = async (uid) => {
    if (dmBusyRef.current) return;
    dmBusyRef.current = true;
    try {
      const { data } = await api.post("/conversations/dm", { user_id: uid });
      if (data?.id) navigate(`/messages/${data.id}`);
    } catch (e) {
      toast.error(errMsg(e, "Gagal membuka obrolan"));
    } finally {
      dmBusyRef.current = false;
    }
  };
  const chip = (on) =>
    `h-9 sm:h-10 whitespace-nowrap rounded-full px-3.5 sm:px-4 text-xs sm:text-sm font-semibold transition-colors ${
      on ? "bg-brand text-white shadow-xs" : "border bg-surface text-sub hover:text-ink"
    }`;

  return (
    <div
      className="mx-auto w-full min-w-0 max-w-6xl overflow-x-clip px-3.5 py-4 sm:px-6 sm:py-6 lg:px-10 lg:py-10 animate-crossfade"
      data-testid="employee-page"
    >
      <PageHeader
        icon={Users}
        title={t("employee_title", "Karyawan")}
        subtitle={`${list.length}/${humanUsers.length} · ${t("employee_subtitle", "Daftar seluruh anggota tim aktif di workspace.")}`}
      />

      <div className="mb-6 flex flex-col gap-2.5 sm:flex-row sm:items-center sm:justify-between" data-testid="division-tabs">
        <div className="flex items-center gap-2 overflow-x-auto pb-1 sm:pb-0 scroll-thin">
          <button onClick={() => setSel([])} className={chip(!sel.length)} data-testid="division-tab-all">
            {t("employee_all_btn", "Semua")}
          </button>
          {divisions.map((d) => (
            <button
              key={d}
              onClick={() => toggle(d)}
              className={chip(sel.includes(d))}
              data-testid={`division-tab-${d.replace(/\s/g, "-")}`}
            >
              {d}{" "}
              <span className="opacity-70">
                {humanUsers.filter((u) => (u.department || "Lainnya") === d).length}
              </span>
            </button>
          ))}
        </div>
        <div className="flex h-10 w-full sm:w-64 shrink-0 items-center gap-2 rounded-full border bg-surface px-4">
          <Search size={15} className="text-sub shrink-0" />
          <input
            value={q}
            onChange={(e) => setQ(e.target.value)}
            placeholder={t("employee_search_placeholder", "Cari nama atau jabatan…")}
            className="flex-1 bg-transparent text-sm outline-none"
            data-testid="employee-search-input"
          />
        </div>
      </div>

      {!list.length ? (
        <Empty icon={Users} title={t("employee_empty_title", "Tidak ada karyawan")} text={t("employee_empty_desc", "Coba ubah kata kunci pencarian atau filter divisi.")} />
      ) : (
        <div className="grid grid-cols-1 gap-3.5 sm:gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 min-w-0">
          {list.map((u) => (
            <div key={u.user_id} className="card flex min-w-0 w-full flex-col justify-between overflow-hidden p-4 sm:p-5" data-testid={`employee-card-${u.user_id}`}>
              <div>
                <button
                  onClick={() => navigate(`/people/${u.user_id}`)}
                  className="flex w-full items-center gap-3 text-left"
                >
                  <Avatar user={u} size={52} />
                  <div className="min-w-0 flex-1">
                    <p className="flex items-center gap-1 truncate font-bold text-ink leading-snug py-0.5">
                      <span className="truncate">
                        {u.name}
                        {u.nickname && <span className="font-medium text-sub"> ({u.nickname})</span>}
                      </span>
                      <VerifiedBadge user={u} size={14} />
                    </p>
                    <p className="truncate text-sm text-sub leading-snug">{u.job_title || "—"}</p>
                    {u.email && (
                      <p className="mt-0.5 flex items-center gap-1 truncate text-xs text-sub">
                        <Mail size={11} className="shrink-0" />
                        <span className="truncate">{u.email}</span>
                      </p>
                    )}
                  </div>
                </button>

                <div className="mt-4 flex flex-wrap gap-1.5 text-xs">
                  {u.department && (
                    <span className="inline-flex items-center gap-1 rounded-full bg-soft-blue px-2.5 py-1 font-medium">
                      <Briefcase size={11} />
                      {u.department}
                    </span>
                  )}
                  {u.company && (
                    <span
                      className="rounded-full bg-soft-purple px-2.5 py-1 font-medium"
                      data-testid={`employee-company-${u.user_id}`}
                    >
                      {u.company}
                    </span>
                  )}
                  {(u.office || u.city) && (
                    <span className="flex items-center gap-1 rounded-full bg-surface2 px-2.5 py-1 text-sub">
                      <MapPin size={11} />
                      {u.office || u.city}
                      {u.work_mode ? ` · ${u.work_mode}` : ""}
                    </span>
                  )}
                  {(() => {
                    const statusMeta = getAvailabilityStatusMeta(u.availability_status);
                    const isOnline = online.has(u.user_id) || u.online;
                    if (statusMeta.value !== "online") {
                      return (
                        <span className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 font-semibold ${statusMeta.badgeClass}`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${statusMeta.dotClass}`} />
                          {statusMeta.label}
                        </span>
                      );
                    }
                    return (
                      <span
                        className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 font-medium ${
                          isOnline
                            ? "bg-soft-green text-emerald-700 dark:text-emerald-300"
                            : "bg-surface2 text-sub"
                        }`}
                      >
                        <span className={`h-1.5 w-1.5 rounded-full ${isOnline ? "bg-emerald-500" : "bg-slate-400"}`} />
                        {isOnline ? "Online" : "Offline"}
                      </span>
                    );
                  })()}
                </div>
              </div>

              <div className="mt-4 grid grid-cols-2 gap-2">
                <button
                  onClick={() => dm(u.user_id)}
                  className="btn-ghost flex h-10 items-center justify-center gap-1.5 border text-sm font-semibold"
                  data-testid={`message-employee-${u.user_id}`}
                >
                  <MessageCircle size={14} />
                  Pesan
                </button>
                <button
                  onClick={() => navigate(`/people/${u.user_id}`)}
                  className="btn-accent h-10 text-sm font-semibold"
                  data-testid={`view-profile-${u.user_id}`}
                >
                  Profil
                </button>
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
