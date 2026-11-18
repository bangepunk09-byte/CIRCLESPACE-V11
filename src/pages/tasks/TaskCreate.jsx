import { useEffect, useMemo, useState } from "react";
import { Paperclip, Link2, X, Plus, Layers } from "lucide-react";
import { toast } from "sonner";
import { api, errMsg } from "../../lib/api";
import { useApp } from "../../context/AppContext";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "../../components/ui/sheet";
import { AppSelect } from "../../components/ui/select";
import { DatePicker, TimePicker } from "../../components/ui/date-picker";
import RichEditor from "../../components/RichEditor";
import { inp, UserSelect, MultiUserSelect, PrioritySelect, StatusSelect, LabelPicker, ItemPicker, ColorPicker, AttachmentList, useUploader, ListEditor } from "./fields";
import { getBoardAssigneeScope, getHumanUsers, isBoardCollaborative } from "./boardScope";
import { CheckpointPresetBar } from "./Checkpoints";
import { playSound } from "../../lib/sound";

const blank = (me, d = {}) => {
  const explicitAssignees = Array.isArray(d?.assignee_ids) && d.assignee_ids.length
    ? d.assignee_ids.filter(Boolean)
    : (d?.assignee_id ? [d.assignee_id] : []);
  return {
    title: "",
    description: "",
    requestor_ids: me?.user_id ? [me.user_id] : ["user_admin1"],
    assignee_id: explicitAssignees[0] || null,
    assignee_ids: explicitAssignees,
    priority: "medium",
    deadline_date: "",
    deadline_time: "",
    start_date: "",
    project_id: d?.project_id || "",
    department: d?.department || "",
    board_id: d?.board_id || "",
    label_ids: d?.label_ids || [],
    item_type: null,
    link_url: "",
    collaborator_ids: [],
    checkpoints: d?.checkpoints || [],
    checklist: [],
    subtasks: [],
    links: [],
    attachments: [],
    estimate: "",
    card_color: null,
    card_style: "accent",
    custom: {},
    status: d?.status || "todo"
  };
};

function Row({ label, children, hint }) {
  return (
    <div className="grid w-full min-w-0 items-start gap-1 sm:grid-cols-[120px_minmax(0,1fr)] sm:gap-3">
      <div className="pt-2 min-w-0">
        <span className="block text-xs font-semibold text-sub">{label}</span>
        {hint && <span className="block text-[10px] text-slate-400 leading-tight">{hint}</span>}
      </div>
      <div className="min-w-0 w-full max-w-full">{children}</div>
    </div>
  );
}

export function toDeadline(date, time) {
  if (!date) return null;
  return new Date(`${date}T${time || "17:00"}`).toISOString();
}

function CheckpointCreator({ checkpoints = [], onChange, members, emptyMessage, defaultPic = null }) {
  const [title, setTitle] = useState("");
  const [deadline, setDeadline] = useState("");
  const [pic, setPic] = useState(null);

  const applyPreset = (items) => {
    const newItems = items.map((t, idx) => ({
      id: `cp_preset_${Date.now()}_${idx}`,
      title: t,
      assignee_id: defaultPic || null,
      unassigned: false,
      deadline: "",
      done: false
    }));
    onChange([...checkpoints, ...newItems]);
  };

  const add = () => {
    if (!title.trim()) return;
    onChange([
      ...checkpoints,
      {
        id: `cp_${Date.now()}_${Math.random().toString(36).substring(2, 7)}`,
        title: title.trim(),
        assignee_id: pic || defaultPic || null,
        unassigned: false,
        deadline: deadline || "",
        done: false
      }
    ]);
    setTitle("");
    setDeadline("");
    setPic(null);
  };

  const remove = (id) => {
    onChange(checkpoints.filter((c) => (c.id || c) !== id));
  };

  return (
    <div className="w-full max-w-full min-w-0 overflow-hidden space-y-3 rounded-2xl border border-slate-200 bg-surface2/60 p-3 sm:p-3.5 dark:border-slate-800" data-testid="task-create-checkpoints">
      {/* Preset & Custom Template quick actions */}
      <CheckpointPresetBar
        onApply={applyPreset}
        currentCheckpoints={checkpoints}
        testidPrefix="preset-btn"
      />

      {/* Added Checkpoints List — 1 line per checkpoint */}
      {checkpoints.length > 0 && (
        <div className="space-y-1.5 pt-1 min-w-0">
          <div className="flex items-center justify-between text-xs font-semibold text-sub">
            <span className="flex items-center gap-1 text-brand"><Layers size={13} /> Checkpoint Aktif · {checkpoints.length}</span>
            <button
              type="button"
              onClick={() => onChange([])}
              className="text-[11px] text-rose-500 hover:underline"
            >
              Hapus Semua
            </button>
          </div>
          <div className="space-y-1.5 max-h-56 overflow-y-auto overflow-x-hidden pr-0.5">
            {checkpoints.map((c, idx) => (
              <div
                key={c.id || idx}
                className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 rounded-xl border border-slate-200 bg-surface px-2.5 py-2 sm:py-1.5 text-xs dark:border-slate-800 shadow-xs min-w-0"
              >
                <div className="flex items-center gap-1.5 flex-1 basis-full sm:basis-0 min-w-0">
                  <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-brand/10 font-bold text-brand text-[10px]">
                    {idx + 1}
                  </span>
                  <input
                    value={c.title}
                    onChange={(e) =>
                      onChange(checkpoints.map((item, i) => (i === idx ? { ...item, title: e.target.value } : item)))
                    }
                    className="min-w-0 w-full flex-1 bg-transparent font-medium text-slate-800 dark:text-slate-200 outline-none truncate"
                  />
                </div>
                <div className="flex items-center gap-1.5 w-full sm:w-auto pl-6 sm:pl-0 shrink-0">
                  <DatePicker
                    compact
                    value={c.deadline ? String(c.deadline).slice(0, 10) : ""}
                    onChange={(val) =>
                      onChange(checkpoints.map((item, i) => (i === idx ? { ...item, deadline: val || "" } : item)))
                    }
                    placeholder="Deadline"
                    title="Deadline checkpoint"
                    className="h-7 flex-1 sm:flex-initial sm:w-[104px] shrink-0 rounded-lg border bg-surface2 px-2 text-[11px] font-medium"
                    data-testid={`task-create-cp-deadline-${idx}`}
                  />
                  <div className="flex-1 sm:flex-initial sm:w-[106px] shrink-0">
                    <UserSelect
                      value={c.assignee_id || (!c.unassigned ? defaultPic : null)}
                      ids={members}
                      emptyMessage={emptyMessage}
                      onChange={(v) =>
                        onChange(
                          checkpoints.map((item, i) =>
                            i === idx ? { ...item, assignee_id: v, unassigned: !v } : item
                          )
                        )
                      }
                      placeholder="PIC"
                      className="h-7 w-full rounded-lg border bg-surface2 pl-2 pr-5 text-[11px] font-semibold outline-none truncate"
                      testid={`task-create-cp-pic-${idx}`}
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => remove(c.id || idx)}
                    className="text-sub hover:text-rose-500 p-1 transition-colors shrink-0"
                    aria-label="Hapus checkpoint"
                  >
                    <X size={14} />
                  </button>
                </div>
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Input new checkpoint */}
      <div className="flex flex-wrap sm:flex-nowrap items-center gap-1.5 pt-1 min-w-0">
        <input
          value={title}
          onChange={(e) => setTitle(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter") {
              e.preventDefault();
              add();
            }
          }}
          placeholder="Tambah checkpoint baru…"
          className="h-9 min-w-0 w-full flex-1 basis-full sm:basis-0 rounded-xl border bg-surface px-3 text-xs outline-none focus:ring-1 focus:ring-brand"
          data-testid="task-create-checkpoint-input"
        />
        <DatePicker
          compact
          value={deadline}
          onChange={setDeadline}
          placeholder="Deadline"
          title="Deadline checkpoint"
          className="h-9 flex-1 sm:flex-initial sm:w-[108px] shrink-0 rounded-xl border bg-surface px-2.5 text-[11px] font-medium"
          data-testid="task-create-checkpoint-deadline"
        />
        <div className="flex-1 sm:flex-initial sm:w-[108px] shrink-0">
          <UserSelect
            value={pic}
            ids={members}
            emptyMessage={emptyMessage}
            onChange={setPic}
            placeholder="PIC"
            className="h-9 w-full rounded-xl border bg-surface pl-2.5 pr-5 text-xs font-semibold outline-none truncate"
            testid="task-create-checkpoint-pic"
          />
        </div>
        <button
          type="button"
          onClick={add}
          disabled={!title.trim()}
          className="btn-accent flex h-9 items-center gap-1 px-2.5 text-xs font-semibold disabled:opacity-40 shrink-0"
          data-testid="task-create-checkpoint-add-btn"
        >
          <Plus size={13} />
          Tambah
        </button>
      </div>
    </div>
  );
}

export default function TaskCreate({ open, onOpenChange, preset, defaults, onCreated }) {
  const { me, ws, users, statuses } = useApp();
  const [f, setF] = useState(() => blank(me, defaults));
  const [boards, setBoards] = useState(() => {
    try {
      const cached = localStorage.getItem("circle_boards_cache");
      if (cached) {
        const parsed = JSON.parse(cached);
        if (Array.isArray(parsed) && parsed.length > 0) return parsed;
      }
    } catch {}
    return [];
  });
  const [link, setLink] = useState("");
  const [more, setMore] = useState(false);
  const [busy, setBusy] = useState(false);
  const setAtt = (fn) => setF((x) => ({ ...x, attachments: fn(x.attachments) }));
  const { pick, input } = useUploader(setAtt);

  const humanUsers = useMemo(() => getHumanUsers(users), [users]);

  const applyBoardDefaults = (initialObj, boardsList) => {
    const list = Array.isArray(boardsList) ? boardsList : [];
    let resolvedBoardId = initialObj.board_id || "";
    if (!resolvedBoardId && list.length > 0) {
      if (initialObj.project_id) {
        const linkedProjectBoard =
          list.find((b) => b.project_id === initialObj.project_id) ||
          list.find((b) => isBoardCollaborative(b));
        resolvedBoardId = linkedProjectBoard?.id || "";
      } else {
        const myDivBoard = me?.department
          ? list.find((b) => b.department && b.department.toLowerCase() === String(me.department).toLowerCase() && !isBoardCollaborative(b))
          : null;
        resolvedBoardId = myDivBoard?.id || list[0]?.id || "";
      }
    }
    const targetBoard = list.find((b) => b.id === resolvedBoardId) || null;
    const resolvedDept = targetBoard ? (targetBoard.department || initialObj.department || "") : initialObj.department;
    const scope = getBoardAssigneeScope({
      board: targetBoard,
      boards: list,
      boardId: resolvedBoardId,
      projectId: initialObj.project_id,
      department: resolvedDept,
      users
    });
    const allowedSet = new Set(scope.ids);
    let nextAssignees = (initialObj.assignee_ids || []).filter((uid) => allowedSet.has(uid));
    if (nextAssignees.length === 0 && !defaults?.assignee_ids && !defaults?.assignee_id && me?.user_id && allowedSet.has(me.user_id)) {
      nextAssignees = [me.user_id];
    }
    return {
      ...initialObj,
      board_id: resolvedBoardId,
      department: resolvedDept,
      assignee_ids: nextAssignees,
      assignee_id: nextAssignees[0] || null
    };
  };

  useEffect(() => {
    if (open) {
      const initial = { ...blank(me, defaults), ...(preset || {}) };
      if ((!initial.assignee_ids || !initial.assignee_ids.length) && initial.assignee_id) {
        initial.assignee_ids = [initial.assignee_id];
      }
      if (!initial.status) initial.status = statuses?.[0]?.key || "todo";
      setF(applyBoardDefaults(initial, boards));
      setMore(false);
      api.get("/boards").then((r) => {
        const list = Array.isArray(r.data) ? r.data : [];
        setBoards(list);
        try { if (list.length > 0) localStorage.setItem("circle_boards_cache", JSON.stringify(list)); } catch {}
        setF((prev) => applyBoardDefaults(prev, list));
      }).catch(() => {});
    }
  }, [open]); // eslint-disable-line

  const assigneeScope = useMemo(
    () =>
      getBoardAssigneeScope({
        boards,
        boardId: f.board_id,
        projectId: f.project_id,
        department: f.department,
        users
      }),
    [boards, f.board_id, f.project_id, f.department, users]
  );
  const members = assigneeScope.ids;

  const set = (k) => (v) => setF((x) => ({ ...x, [k]: v?.target ? v.target.value : v }));

  const toggleRequestor = (uid) => {
    const curr = f.requestor_ids || [];
    if (curr.includes(uid)) {
      if (curr.length === 1) return toast.error("Minimal harus ada 1 requestor");
      setF((x) => ({ ...x, requestor_ids: curr.filter((id) => id !== uid) }));
    } else {
      setF((x) => ({ ...x, requestor_ids: [...curr, uid] }));
    }
  };

  const submit = async (e) => {
    e?.preventDefault();
    if (!f.title.trim()) return toast.error("Judul tugas wajib diisi");
    setBusy(true);
    try {
      const cpPics = (f.checkpoints || []).map((c) => c?.assignee_id).filter(Boolean);
      let assigneeIds = Array.isArray(f.assignee_ids) && f.assignee_ids.length
        ? f.assignee_ids.filter(Boolean)
        : (f.assignee_id ? [f.assignee_id] : []);
      if (assigneeIds.length === 0 && cpPics.length > 0) {
        assigneeIds = Array.from(new Set(cpPics));
      }
      const primaryAssigneeId = assigneeIds[0] || null;
      const normalizedCheckpoints = (f.checkpoints || []).map((c) =>
        c && !c.assignee_id && !c.unassigned && primaryAssigneeId
          ? { ...c, assignee_id: primaryAssigneeId }
          : c
      );
      const myUserId = me?.user_id || "user_admin1";
      const reqIds = f.requestor_ids && f.requestor_ids.length ? f.requestor_ids : [myUserId];

      const { deadline_date, deadline_time, ...rest } = f;
      const { data } = await api.post("/tasks", {
        ...rest,
        checkpoints: normalizedCheckpoints,
        status: f.status || statuses?.[0]?.key || "todo",
        board_id: f.board_id || "",
        assignee_id: primaryAssigneeId,
        assignee_ids: assigneeIds,
        requestor_ids: reqIds,
        reviewer_ids: reqIds,
        project_id: f.project_id || null,
        deadline: toDeadline(deadline_date, deadline_time),
        deadline_has_time: !!deadline_time,
        start_date: f.start_date || null,
        estimate: f.estimate || null
      });
      toast.success(`Tugas ${data.number_str || ""} berhasil dibuat!`);
      playSound("task_create");
      onOpenChange(false);
      onCreated?.(data);
    } catch (er) { toast.error(errMsg(er)); }
    setBusy(false);
  };
  return (
    <Sheet open={open} onOpenChange={onOpenChange}>
      <SheetContent className="w-full max-w-full overflow-y-auto overflow-x-hidden bg-surface p-0 sm:max-w-3xl" data-testid="task-create-panel">
        <form onSubmit={submit} className="flex min-h-full w-full max-w-full min-w-0 flex-col overflow-x-hidden">
          <SheetHeader className="border-b px-4 py-3.5 sm:p-5"><SheetTitle>Buat Tugas Baru</SheetTitle></SheetHeader>
          <div className="flex-1 w-full max-w-full min-w-0 space-y-4 p-4 sm:p-5 overflow-x-hidden">
            <input autoFocus value={f.title} onChange={set("title")} placeholder="Judul tugas..." className="w-full bg-transparent text-xl sm:text-2xl font-bold outline-none placeholder:text-sub" data-testid="task-title-input" />
            <RichEditor value={f.description} onChange={set("description")} testid="task-description-editor" />
            
            {/* Multiple Requestors */}
            <Row label="Requestor">
              <div className="flex flex-wrap gap-1.5" data-testid="task-requestor-list">
                {humanUsers.map((u) => {
                  const isSelected = (f.requestor_ids || []).includes(u.user_id);
                  return (
                    <button
                      type="button"
                      key={u.user_id}
                      onClick={() => toggleRequestor(u.user_id)}
                      className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1 text-xs font-medium transition-all cursor-pointer ${
                        isSelected
                          ? "border-[var(--c-accent)] bg-brand text-white shadow-sm"
                          : "border-slate-200 bg-surface hover:bg-surface2 text-slate-700 dark:text-slate-200"
                      }`}
                      data-testid={`requestor-toggle-${u.user_id}`}
                    >
                      <span>{u.name.split(" ")[0]}</span>
                      {isSelected && <span>✓</span>}
                    </button>
                  );
                })}
              </div>
            </Row>

            <Row label="Board">
              <AppSelect
                value={f.board_id || ""}
                onChange={(e) => {
                  const bid = e.target.value;
                  const b = boards.find((x) => x.id === bid) || null;
                  const nextDept = b ? (b.department || "") : "";
                  const nextScope = getBoardAssigneeScope({
                    board: b,
                    boards,
                    boardId: bid,
                    projectId: f.project_id,
                    department: nextDept,
                    users
                  });
                  const allowedSet = new Set(nextScope.ids);
                  setF((prev) => {
                    const filteredAssignees = (prev.assignee_ids || []).filter((uid) => allowedSet.has(uid));
                    const filteredCps = (prev.checkpoints || []).map((c) =>
                      c && c.assignee_id && !allowedSet.has(c.assignee_id)
                        ? { ...c, assignee_id: null }
                        : c
                    );
                    return {
                      ...prev,
                      board_id: bid,
                      department: nextDept,
                      assignee_ids: filteredAssignees,
                      assignee_id: filteredAssignees[0] || null,
                      checkpoints: filteredCps
                    };
                  });
                }}
                className={inp}
                data-testid="task-board-select"
              >
                {(f.project_id || boards.length === 0) && (
                  <option value="">Mode Proyek Kolaborasi</option>
                )}
                {boards.map((b) => (
                  <option key={b.id} value={b.id}>
                    {b.name}
                    {isBoardCollaborative(b)
                      ? " · Kolaborasi"
                      : b.department && b.department !== b.name
                      ? ` · ${b.department}`
                      : ""}
                  </option>
                ))}
              </AppSelect>
            </Row>

            <Row label="Status">
              <StatusSelect
                value={f.status || "todo"}
                onChange={set("status")}
                testid="task-status-select"
              />
            </Row>

            <Row label="Assignee">
              <MultiUserSelect
                value={f.assignee_ids || (f.assignee_id ? [f.assignee_id] : [])}
                onChange={(ids) =>
                  setF((prev) => {
                    const prevPrimary = prev.assignee_ids?.[0] || prev.assignee_id || null;
                    const nextPrimary = ids[0] || null;
                    const updatedCps = (prev.checkpoints || []).map((c) => {
                      if (!c || c.unassigned) return c;
                      if (!c.assignee_id || (prevPrimary && c.assignee_id === prevPrimary && nextPrimary && !ids.includes(c.assignee_id))) {
                        return { ...c, assignee_id: nextPrimary };
                      }
                      return c;
                    });
                    return { ...prev, assignee_ids: ids, assignee_id: nextPrimary, checkpoints: updatedCps };
                  })
                }
                ids={members}
                scopeLabel={assigneeScope.scopeLabel}
                emptyMessage={assigneeScope.emptyMessage}
                testid="task-assignee-select"
              />
            </Row>
            <Row label="Prioritas"><PrioritySelect value={f.priority} onChange={set("priority")} testid="task-priority-select" /></Row>
            <Row label="Deadline"><div className="flex gap-2"><DatePicker value={f.deadline_date} onChange={set("deadline_date")} placeholder="Pilih tanggal" className={inp} data-testid="task-deadline-input" /><TimePicker value={f.deadline_time} onChange={set("deadline_time")} placeholder="Jam" className={`${inp} w-32 shrink-0`} data-testid="task-deadline-time-input" /></div></Row>

            {/* Checkpoints */}
            <Row label="Checkpoint" hint="Ukur progres tugas per checkpoint">
              <CheckpointCreator
                checkpoints={f.checkpoints}
                onChange={set("checkpoints")}
                members={members}
                emptyMessage={assigneeScope.emptyMessage}
                defaultPic={f.assignee_ids?.[0] || f.assignee_id || null}
              />
            </Row>

            <Row label="IP / Brand"><LabelPicker value={f.label_ids} onChange={set("label_ids")} testid="task-label-picker" /></Row>
            <Row label="Jenis Item"><ItemPicker value={f.item_type} onChange={set("item_type")} testid="task-item-picker" /></Row>
            <Row label="Link File / Folder"><input value={f.link_url} onChange={set("link_url")} placeholder="https://…" className={inp} data-testid="task-link-input" /></Row>
            <Row label="Lampiran"><div className="space-y-2"><AttachmentList items={f.attachments} onRemove={(a) => setAtt((x) => x.filter((y) => y.id !== a.id))} /><button type="button" onClick={pick} className="flex items-center gap-1.5 text-sm font-semibold text-brand" data-testid="task-add-attachment-btn"><Paperclip size={14} />Tambah gambar atau dokumen</button>{input}</div></Row>
            {!more ? <button type="button" onClick={() => setMore(true)} className="text-sm font-semibold text-sub hover:text-ink" data-testid="task-more-fields-btn">+ Field lainnya</button> : <>
              <Row label="Kolaborator"><div className="flex flex-wrap gap-1">{humanUsers.map((u) => { const on = f.collaborator_ids.includes(u.user_id); return <button type="button" key={u.user_id} onClick={() => set("collaborator_ids")(on ? f.collaborator_ids.filter((x) => x !== u.user_id) : [...f.collaborator_ids, u.user_id])} className={`rounded-full border px-2.5 py-1 text-xs ${on ? "border-[var(--c-accent)] bg-soft-red" : ""}`}>{u.name.split(" ")[0]}</button>; })}</div></Row>
              <Row label="Checklist"><ListEditor items={f.checklist} onChange={set("checklist")} placeholder="Tambah item checklist" testid="task-checklist-editor" /></Row>
              <Row label="Subtugas"><ListEditor items={f.subtasks} onChange={set("subtasks")} field="title" placeholder="Tambah subtugas" testid="task-subtasks-editor" /></Row>
              <Row label="Link Referensi"><div>{f.links.map((l, i) => <div key={`${l}-${i}`} className="flex items-center gap-2 py-0.5 text-sm"><Link2 size={13} className="text-sub" /><a href={l} target="_blank" rel="noreferrer" className="flex-1 truncate text-brand">{l}</a><button type="button" onClick={() => set("links")(f.links.filter((x) => x !== l))} aria-label="Hapus link"><X size={13} /></button></div>)}
                <div className="flex gap-1"><input value={link} onChange={(e) => setLink(e.target.value)} placeholder="https://…" className={inp} data-testid="task-link-input" /><button type="button" onClick={() => { if (/^https?:\/\//.test(link)) { set("links")([...f.links, link]); setLink(""); } else toast.error("Masukkan URL yang valid"); }} className="rounded-xl border px-3 text-sm" data-testid="task-add-link-btn">Tambah</button></div></div></Row>
              <Row label="Estimasi Durasi"><input value={f.estimate} onChange={set("estimate")} placeholder="mis. 4 jam, 2 hari" className={inp} /></Row>
              <Row label="Warna Kartu"><ColorPicker value={f.card_color} onChange={set("card_color")} style={f.card_style} onStyle={set("card_style")} /></Row>
              {(ws?.task_fields || []).map((cf) => <Row key={cf.key} label={cf.name}><input value={f.custom[cf.key] || ""} onChange={(e) => set("custom")({ ...f.custom, [cf.key]: e.target.value })} className={inp} /></Row>)}
            </>}
          </div>
          <div className="sticky bottom-0 flex items-center gap-3 border-t bg-surface px-4 py-3.5 pb-[max(1rem,env(safe-area-inset-bottom))] sm:px-6 sm:py-5 sm:pb-7 shadow-lg">
            <button type="button" onClick={() => onOpenChange(false)} className="btn-ghost h-11 flex-1 border font-semibold text-sm">Batal</button>
            <button disabled={busy} className="btn-accent h-11 flex-[2] font-semibold text-sm disabled:opacity-50" data-testid="task-create-submit-btn">Buat Tugas</button>
          </div>
        </form>
      </SheetContent>
    </Sheet>
  );
}

