import { Printer, FileDown, FileCode2 } from "lucide-react";
import { toast } from "sonner";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "./ui/dialog";
import { AccentButton, GhostButton, fmtDate } from "./common";
import {
  buildTaskReportRows,
  downloadTaskReportPDF,
  downloadTaskReportHTML,
  downloadTaskDetailPDF,
  tryNativePrint
} from "../lib/printReport";

export default function PrintPreviewDialog({
  open,
  onOpenChange,
  mode = "list", // "list" | "detail"
  tasks = [],
  task = null,
  boardName = "Semua Board",
  view = "list",
  reportMode = "checkpoint",
  userMap = {},
  labelMap = {},
  statuses = []
}) {
  const rows = mode === "list" ? buildTaskReportRows(tasks, { userMap, labelMap, reportMode }) : [];
  const nowStr = fmtDate(new Date().toISOString(), "d MMM yyyy HH:mm");

  const handleDownloadPDF = async () => {
    try {
      if (mode === "detail" && task) {
        await downloadTaskDetailPDF({ task, userMap, labelMap, statuses, boardName });
      } else {
        await downloadTaskReportPDF({ tasks, boardName, view, reportMode, userMap, labelMap });
      }
      toast.success("File PDF berhasil diunduh dan siap dicetak!");
    } catch (e) {
      toast.error(e?.message || "Gagal membuat PDF");
    }
  };

  const handleDownloadHTML = () => {
    try {
      downloadTaskReportHTML({
        tasks: mode === "detail" && task ? [task] : tasks,
        boardName,
        reportMode: mode === "detail" ? "checkpoint" : reportMode,
        userMap,
        labelMap
      });
      toast.success("File HTML siap cetak diunduh! Buka file lalu tekan Print.");
    } catch (e) {
      toast.error(e?.message || "Gagal membuat file HTML");
    }
  };

  const handleBrowserPrint = () => {
    onOpenChange(false);
    setTimeout(() => {
      const ok = tryNativePrint();
      if (!ok) {
        toast.info("Browser preview iframe membatasi popup print langsung — silakan klik Unduh PDF.");
        onOpenChange(true);
      }
    }, 150);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="bg-surface rounded-3xl max-w-5xl w-[95vw] max-h-[88vh] flex flex-col p-0 overflow-hidden" data-testid="print-preview-dialog">
        <DialogHeader className="px-6 py-4 border-b shrink-0">
          <DialogTitle className="flex items-center gap-2 text-lg font-bold">
            <Printer size={18} className="text-brand" />
            <span>{mode === "detail" ? `Cetak Detail Tugas — ${task?.number_str || ""}` : `Pratinjau Cetak Laporan — ${boardName}`}</span>
          </DialogTitle>
          <p className="text-xs text-sub mt-1">
            Pratinjau aplikasi berada di dalam iframe sehingga dialog cetak bawaan browser dibatasi. Gunakan <b>Unduh PDF</b> untuk mencetak langsung dengan rapi.
          </p>
        </DialogHeader>

        <div className="flex-1 overflow-y-auto p-5 bg-slate-100/80 dark:bg-slate-900/50">
          <div className="mx-auto bg-white text-slate-900 rounded-2xl border border-slate-200 shadow-sm p-6">
            <div className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-slate-800 pb-3 mb-4">
              <div>
                <p className="text-[10px] font-bold uppercase tracking-widest text-slate-500">CIRCLE WORKSPACE · LAPORAN TUGAS</p>
                <h2 className="text-xl font-extrabold text-slate-900">
                  {mode === "detail" ? `${task?.number_str || ""} — ${task?.title || ""}` : `Laporan Tugas — ${boardName}`}
                </h2>
              </div>
              <div className="text-right text-xs text-slate-600">
                {mode === "list" && (
                  <p>
                    Mode: <b>{reportMode === "checkpoint" ? "Per Tahap PIC" : "Per Kartu Tugas"}</b> · Total: <b>{rows.length} baris</b>
                  </p>
                )}
                <p>Dicetak: {nowStr}</p>
              </div>
            </div>

            {mode === "list" ? (
              <div className="overflow-x-auto">
                <table className="w-full border-collapse text-left text-xs">
                  <thead>
                    <tr className="bg-slate-100 text-slate-800">
                      <th className="border border-slate-200 px-2 py-2 text-center w-8">#</th>
                      <th className="border border-slate-200 px-2 py-2">Requestor</th>
                      <th className="border border-slate-200 px-2 py-2">Assignee / PIC</th>
                      <th className="border border-slate-200 px-2 py-2">Brand</th>
                      <th className="border border-slate-200 px-2 py-2">Jenis Item</th>
                      <th className="border border-slate-200 px-2 py-2">Judul Tugas &amp; Tahap</th>
                      <th className="border border-slate-200 px-2 py-2">Prioritas</th>
                      <th className="border border-slate-200 px-2 py-2">Deadline</th>
                      <th className="border border-slate-200 px-2 py-2">Status</th>
                    </tr>
                  </thead>
                  <tbody>
                    {rows.map((r) => (
                      <tr key={`${r.no}_${r.taskId}`} className="even:bg-slate-50/70">
                        <td className="border border-slate-200 px-2 py-1.5 text-center text-slate-500">{r.no}</td>
                        <td className="border border-slate-200 px-2 py-1.5">{r.requestor}</td>
                        <td className="border border-slate-200 px-2 py-1.5 font-medium">{r.assignee}</td>
                        <td className="border border-slate-200 px-2 py-1.5">{r.brand}</td>
                        <td className="border border-slate-200 px-2 py-1.5">{r.item}</td>
                        <td className="border border-slate-200 px-2 py-1.5">
                          <span className="font-semibold">{r.title}</span>
                          {r.stage && (
                            <span className="ml-1.5 inline-block rounded-full bg-rose-50 px-2 py-0.5 text-[10px] font-semibold text-rose-600">
                              {r.stage}
                            </span>
                          )}
                        </td>
                        <td className="border border-slate-200 px-2 py-1.5">{r.priority}</td>
                        <td className="border border-slate-200 px-2 py-1.5 whitespace-nowrap">{r.deadline}</td>
                        <td className="border border-slate-200 px-2 py-1.5">
                          <span
                            className={`inline-block rounded-full px-2 py-0.5 text-[11px] font-bold ${
                              r.status === "On time"
                                ? "bg-emerald-100 text-emerald-800"
                                : r.status === "Overdue"
                                ? "bg-rose-100 text-rose-800"
                                : "bg-amber-100 text-amber-800"
                            }`}
                          >
                            {r.status}
                          </span>
                        </td>
                      </tr>
                    ))}
                    {rows.length === 0 && (
                      <tr>
                        <td colSpan={9} className="border border-slate-200 px-3 py-6 text-center text-slate-500">
                          Tidak ada data tugas untuk dicetak.
                        </td>
                      </tr>
                    )}
                  </tbody>
                </table>
              </div>
            ) : task ? (
              <div className="space-y-4 text-xs">
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 rounded-xl bg-slate-50 p-3 border border-slate-200">
                  <div><span className="text-slate-500 block">Status</span><b>{statuses.find((s) => s.key === task.status)?.name || task.status}</b></div>
                  <div><span className="text-slate-500 block">Prioritas</span><b className="capitalize">{task.priority || "Sedang"}</b></div>
                  <div><span className="text-slate-500 block">Deadline</span><b>{task.deadline ? fmtDate(task.deadline, "d MMM yyyy HH:mm") : "—"}</b></div>
                  <div><span className="text-slate-500 block">Jenis Item</span><b>{task.item_type || "—"}</b></div>
                </div>
                {Array.isArray(task.checkpoints) && task.checkpoints.length > 0 && (
                  <div>
                    <h3 className="font-bold text-sm mb-2">Tahapan Checkpoint ({task.checkpoints.length})</h3>
                    <table className="w-full border-collapse text-left text-xs">
                      <thead>
                        <tr className="bg-slate-100">
                          <th className="border border-slate-200 px-2 py-1.5 w-8 text-center">#</th>
                          <th className="border border-slate-200 px-2 py-1.5">Tahap</th>
                          <th className="border border-slate-200 px-2 py-1.5">PIC</th>
                          <th className="border border-slate-200 px-2 py-1.5">Deadline</th>
                          <th className="border border-slate-200 px-2 py-1.5">Status</th>
                        </tr>
                      </thead>
                      <tbody>
                        {task.checkpoints.map((cp, idx) => (
                          <tr key={cp.id || idx}>
                            <td className="border border-slate-200 px-2 py-1.5 text-center">{idx + 1}</td>
                            <td className="border border-slate-200 px-2 py-1.5 font-medium">{cp.title}</td>
                            <td className="border border-slate-200 px-2 py-1.5">{cp.assignee_id ? (userMap[cp.assignee_id]?.name || cp.assignee_id) : "Belum Ditugaskan"}</td>
                            <td className="border border-slate-200 px-2 py-1.5">{cp.deadline ? fmtDate(cp.deadline, "d MMM yyyy") : "—"}</td>
                            <td className="border border-slate-200 px-2 py-1.5 font-semibold">{cp.done ? "Selesai" : "Berjalan"}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                )}
              </div>
            ) : null}
          </div>
        </div>

        <DialogFooter className="px-6 py-3.5 border-t bg-surface shrink-0 flex flex-wrap items-center justify-between gap-2">
          <GhostButton type="button" onClick={() => onOpenChange(false)} className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold">
            Tutup
          </GhostButton>
          <div className="flex flex-wrap items-center gap-2">
            <GhostButton type="button" onClick={handleBrowserPrint} className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold" data-testid="print-native-fallback-btn">
              <Printer size={14} /> Coba Print Browser
            </GhostButton>
            <GhostButton type="button" onClick={handleDownloadHTML} className="h-10 rounded-full px-4 text-xs sm:text-sm font-semibold whitespace-nowrap" data-testid="print-download-html-btn">
              <FileCode2 size={14} /> Unduh HTML
            </GhostButton>
            <AccentButton type="button" onClick={handleDownloadPDF} className="h-10 rounded-full px-5 text-xs sm:text-sm font-semibold whitespace-nowrap" data-testid="print-download-pdf-btn">
              <FileDown size={14} /> Unduh PDF
            </AccentButton>
          </div>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
