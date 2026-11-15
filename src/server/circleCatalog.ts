export interface CircleFeatureItem {
  id: string;
  command: string;
  aliases?: string[];
  category: string;
  title: string;
  description: string;
  template: string;
  example: string;
  instant?: boolean; // Can be executed immediately with 1 click without user parameters
  mutates?: boolean; // Mutates real workspace data
}

export const CIRCLE_FEATURE_CATEGORIES = [
  "Semua",
  "Tugas & Sprint",
  "Analitik & Load Tim",
  "Meeting & Jadwal",
  "Fokus & Catatan Kerja",
  "Komunikasi & Beranda",
  "Proyek, Brand & Konten",
  "AI Produktivitas & Bahasa",
  "Admin, Drive & Audit"
] as const;

export const CIRCLE_FEATURE_CATALOG: CircleFeatureItem[] = [
  // === 1. TUGAS & SPRINT (12 fitur) ===
  {
    id: "task_smart_create",
    command: "/task",
    aliases: ["buat task", "buatkan tugas"],
    category: "Tugas & Sprint",
    title: "Buat Tugas Pintar (Smart Parsing)",
    description: "Buat tugas baru lengkap dengan PIC (@nama), prioritas (!urgent/high/low), brand (#label), dan deadline otomatis.",
    template: "/task [Judul tugas] !high deadline besok",
    example: "/task Revisi Landing Page Q4 !urgent deadline besok",
    mutates: true
  },
  {
    id: "task_subtask",
    command: "/subtask",
    category: "Tugas & Sprint",
    title: "Tambah Subtugas Langsung",
    description: "Tambahkan subtugas ke kartu tugas (TSK-xxx) langsung dari jendela chat.",
    template: "/subtask TSK-001 | ",
    example: "/subtask TSK-001 | Finalisasi copywriting hero banner",
    mutates: true
  },
  {
    id: "task_checkpoint",
    command: "/checkpoint",
    category: "Tugas & Sprint",
    title: "Tambah Checkpoint / Milestone",
    description: "Sisipkan checkpoint baru pada kartu tugas untuk melacak progres bertahap.",
    template: "/checkpoint TSK-001 | ",
    example: "/checkpoint TSK-001 | Approval Direktur Marketing",
    mutates: true
  },
  {
    id: "task_done",
    command: "/done",
    category: "Tugas & Sprint",
    title: "Tandai Tugas Selesai",
    description: "Ubah status tugas (TSK-xxx) menjadi Selesai (Done) dan catat riwayat penyelesaian.",
    template: "/done TSK-001",
    example: "/done TSK-001",
    mutates: true
  },
  {
    id: "task_status",
    command: "/status",
    category: "Tugas & Sprint",
    title: "Ubah Status Tugas",
    description: "Pindahkan status tugas ke todo, in_progress, in_review, atau done secara instan.",
    template: "/status TSK-001 | in_progress",
    example: "/status TSK-001 | in_review",
    mutates: true
  },
  {
    id: "task_priority",
    command: "/priority",
    category: "Tugas & Sprint",
    title: "Ubah Prioritas Tugas",
    description: "Sesuaikan tingkat urgensi tugas (urgent, high, medium, low) tanpa membuka board.",
    template: "/priority TSK-001 | high",
    example: "/priority TSK-001 | urgent",
    mutates: true
  },
  {
    id: "task_assign",
    command: "/assign",
    category: "Tugas & Sprint",
    title: "Tugaskan PIC ke Anggota",
    description: "Tetapkan atau pindahkan PIC tugas ke anggota tim berdasarkan nama atau email.",
    template: "/assign TSK-001 | ",
    example: "/assign TSK-001 | Rian Marketing",
    mutates: true
  },
  {
    id: "task_deadline",
    command: "/deadline",
    category: "Tugas & Sprint",
    title: "Atur Ulang Deadline Tugas",
    description: "Perbarui tenggat waktu tugas dengan format natural (hari ini, besok, +3 hari, atau tanggal).",
    template: "/deadline TSK-001 | besok",
    example: "/deadline TSK-001 | +2 hari",
    mutates: true
  },
  {
    id: "task_comment",
    command: "/comment",
    category: "Tugas & Sprint",
    title: "Kirim Komentar ke Tugas",
    description: "Tambahkan catatan progres atau feedback langsung ke kartu tugas terkait.",
    template: "/comment TSK-001 | ",
    example: "/comment TSK-001 | Draft sudah di-upload ke folder Drive.",
    mutates: true
  },
  {
    id: "task_issue",
    command: "/issue",
    category: "Tugas & Sprint",
    title: "Laporkan Kendala / Blocker",
    description: "Tandai kendala resmi pada tugas agar muncul di radar blocker manajer.",
    template: "/issue TSK-001 | ",
    example: "/issue TSK-001 | Menunggu asset logo resolusi tinggi dari klien.",
    mutates: true
  },
  {
    id: "task_auto_archive",
    command: "/auto-archive",
    category: "Tugas & Sprint",
    title: "Arsipkan Semua Tugas Done",
    description: "Jalankan pengarsipan otomatis untuk merapikan seluruh kartu yang sudah berstatus Done.",
    template: "/auto-archive",
    example: "/auto-archive",
    instant: true,
    mutates: true
  },
  {
    id: "task_sprint_plan",
    command: "/sprint-plan",
    aliases: ["rencana sprint"],
    category: "Tugas & Sprint",
    title: "Perencana Prioritas Sprint",
    description: "Susun antrean eksekusi sprint otomatis berdasarkan urgensi, deadline, dan kapasitas tim.",
    template: "/sprint-plan",
    example: "/sprint-plan",
    instant: true
  },

  // === 2. ANALITIK & LOAD TIM (10 fitur) ===
  {
    id: "analytics_recommend",
    command: "/recommend",
    aliases: ["siapa yang cocok", "rekomendasi pic"],
    category: "Analitik & Load Tim",
    title: "Rekomendasi PIC Optimal",
    description: "Cari kandidat anggota paling siap mengerjakan tugas baru berdasarkan load & overdue terendah.",
    template: "/recommend ",
    example: "/recommend Marketing",
    instant: true
  },
  {
    id: "analytics_rebalance",
    command: "/rebalance",
    aliases: ["seimbangkan beban"],
    category: "Analitik & Load Tim",
    title: "Planner Penyeimbang Beban Kerja",
    description: "Identifikasi anggota Under Pressure vs Optimal dan rekomendasikan pemindahan tugas konkret.",
    template: "/rebalance",
    example: "/rebalance Marketing",
    instant: true
  },
  {
    id: "analytics_blockers",
    command: "/blockers",
    aliases: ["kendala tim", "ada kendala"],
    category: "Analitik & Load Tim",
    title: "Scanner Kendala & Bottleneck",
    description: "Kumpulkan seluruh kendala belum selesai, tugas macet di Review, dan tugas tanpa PIC.",
    template: "/blockers",
    example: "/blockers",
    instant: true
  },
  {
    id: "analytics_kpi",
    command: "/kpi",
    aliases: ["scorecard"],
    category: "Analitik & Load Tim",
    title: "KPI & Scorecard Performa",
    description: "Hitung tingkat ketepatan waktu, total selesai, beban aktif, dan progres checkpoint individu/tim.",
    template: "/kpi",
    example: "/kpi",
    instant: true
  },
  {
    id: "analytics_sla",
    command: "/sla",
    aliases: ["ketepatan deadline"],
    category: "Analitik & Load Tim",
    title: "Laporan Kepatuhan SLA Deadline",
    description: "Analisa persentase tugas selesai tepat waktu dibanding terlambat di tiap divisi.",
    template: "/sla",
    example: "/sla",
    instant: true
  },
  {
    id: "analytics_leaderboard",
    command: "/leaderboard",
    aliases: ["ranking produktivitas"],
    category: "Analitik & Load Tim",
    title: "Leaderboard Produktivitas Tim",
    description: "Peringkat kecepatan penyelesaian tugas antar divisi dan top contributor workspace.",
    template: "/leaderboard",
    example: "/leaderboard",
    instant: true
  },
  {
    id: "analytics_risk",
    command: "/risk",
    aliases: ["risiko deadline"],
    category: "Analitik & Load Tim",
    title: "Matriks Risiko Keterlambatan",
    description: "Deteksi tugas prioritas Urgent/High yang masih berstatus To Do atau hampir jatuh tempo.",
    template: "/risk",
    example: "/risk",
    instant: true
  },
  {
    id: "analytics_unassigned",
    command: "/unassigned",
    aliases: ["tanpa pic"],
    category: "Analitik & Load Tim",
    title: "Radar Tugas Tanpa PIC",
    description: "Daftar seluruh tugas aktif yang belum ditugaskan ke siapapun beserta saran PIC.",
    template: "/unassigned",
    example: "/unassigned",
    instant: true
  },
  {
    id: "analytics_review_queue",
    command: "/review-queue",
    aliases: ["antrean review"],
    category: "Analitik & Load Tim",
    title: "Monitor Antrean Review & Approval",
    description: "Pantau tugas berstatus In Review dan kartu approval yang membutuhkan keputusan cepat.",
    template: "/review-queue",
    example: "/review-queue",
    instant: true
  },
  {
    id: "analytics_standup",
    command: "/standup",
    aliases: ["laporan standup"],
    category: "Analitik & Load Tim",
    title: "Generator Daily Standup",
    description: "Susun otomatis laporan Yesterday, Today, dan Blockers Anda siap salin untuk rapat harian.",
    template: "/standup",
    example: "/standup",
    instant: true
  },

  // === 3. MEETING & JADWAL (7 fitur) ===
  {
    id: "meeting_create",
    command: "/meeting",
    category: "Meeting & Jadwal",
    title: "Jadwalkan Meeting Otomatis",
    description: "Buat jadwal meeting lengkap dengan link Google Meet langsung masuk ke kalender tim.",
    template: "/meeting [Judul] | besok | 10:00",
    example: "/meeting Sinkronisasi Campaign Q4 | besok | 14:00",
    mutates: true
  },
  {
    id: "meeting_today",
    command: "/schedule-today",
    aliases: ["agenda hari ini"],
    category: "Meeting & Jadwal",
    title: "Agenda & Deadline Hari Ini",
    description: "Gabungan kronologis seluruh jadwal meeting dan tenggat waktu tugas hari ini.",
    template: "/schedule-today",
    example: "/schedule-today",
    instant: true
  },
  {
    id: "meeting_prep",
    command: "/meeting-prep",
    category: "Meeting & Jadwal",
    title: "Siapkan Agenda & Brief Meeting",
    description: "Buat poin agenda rapat otomatis berdasarkan tugas aktif, overdue, dan blocker divisi/proyek.",
    template: "/meeting-prep ",
    example: "/meeting-prep Marketing",
    instant: true
  },
  {
    id: "meeting_free_slot",
    command: "/free-slot",
    category: "Meeting & Jadwal",
    title: "Cari Slot Jam Kosong Tim",
    description: "Temukan jam kosong (09:00–17:00 WIB) yang tidak bentrok dengan agenda meeting terjadwal.",
    template: "/free-slot",
    example: "/free-slot besok",
    instant: true
  },
  {
    id: "meeting_mom",
    command: "/mom",
    category: "Meeting & Jadwal",
    title: "Generator Notulensi Rapat (MoM)",
    description: "Ubah catatan rapat mentah menjadi Notulensi terstruktur lengkap dengan daftar Action Items.",
    template: "/mom ",
    example: "/mom Rapat bahas launch Jumat, Rian siapkan deck besok, Budi urus iklan Meta."
  },
  {
    id: "meeting_cancel",
    command: "/cancel-meeting",
    category: "Meeting & Jadwal",
    title: "Batalkan Jadwal Meeting",
    description: "Hapus/batalkan jadwal meeting berdasarkan kata kunci judul langsung dari chat.",
    template: "/cancel-meeting ",
    example: "/cancel-meeting Sinkronisasi",
    mutates: true
  },
  {
    id: "meeting_deadline_calendar",
    command: "/deadline-calendar",
    category: "Meeting & Jadwal",
    title: "Kalender Deadline 7 Hari",
    description: "Peta distribusi tenggat tugas 7 hari ke depan agar tim bisa mengantisipasi hari padat.",
    template: "/deadline-calendar",
    example: "/deadline-calendar",
    instant: true
  },

  // === 4. FOKUS & CATATAN KERJA (6 fitur) ===
  {
    id: "focus_remind",
    command: "/remind",
    category: "Fokus & Catatan Kerja",
    title: "Buat Pengingat Pribadi",
    description: "Simpan pengingat kerja ke daftar Pengingat workspace dengan target tanggal/waktu.",
    template: "/remind [Pesan pengingat] | besok 09:00",
    example: "/remind Follow up invoice vendor PT Maju | besok 10:00",
    mutates: true
  },
  {
    id: "focus_reminders_list",
    command: "/reminders",
    category: "Fokus & Catatan Kerja",
    title: "Daftar Pengingat Aktif",
    description: "Tampilkan seluruh pengingat aktif Anda yang belum diselesaikan.",
    template: "/reminders",
    example: "/reminders",
    instant: true
  },
  {
    id: "focus_done_reminder",
    command: "/done-reminder",
    category: "Fokus & Catatan Kerja",
    title: "Selesaikan Pengingat",
    description: "Tandai pengingat tertentu sebagai selesai berdasarkan kata kunci judulnya.",
    template: "/done-reminder ",
    example: "/done-reminder invoice",
    mutates: true
  },
  {
    id: "focus_mit",
    command: "/focus",
    aliases: ["/pomodoro"],
    category: "Fokus & Catatan Kerja",
    title: "Mode Fokus (Top 3 Priority)",
    description: "Pilih 3 tugas paling krusial milik Anda hari ini lengkap dengan rekomendasi urutan eksekusi.",
    template: "/focus",
    example: "/focus",
    instant: true
  },
  {
    id: "focus_note",
    command: "/note",
    category: "Fokus & Catatan Kerja",
    title: "Simpan Catatan Kerja Cepat",
    description: "Catat ide, link penting, atau memo kerja yang tersimpan permanen di akun Anda.",
    template: "/note [Judul] | [Isi catatan]",
    example: "/note Konsep Q4 | Fokus ke short video & kolaborasi KOL micro",
    mutates: true
  },
  {
    id: "focus_notes_list",
    command: "/notes",
    category: "Fokus & Catatan Kerja",
    title: "Lihat Semua Catatan Tersimpan",
    description: "Buka kembali seluruh memo dan catatan pribadi yang pernah Anda simpan di Circle.",
    template: "/notes",
    example: "/notes",
    instant: true
  },

  // === 5. KOMUNIKASI & BERANDA (7 fitur) ===
  {
    id: "comm_post",
    command: "/post",
    category: "Komunikasi & Beranda",
    title: "Terbitkan Postingan ke Beranda",
    description: "Publikasikan update tim lengkap dengan #hashtag langsung ke feed Beranda perusahaan.",
    template: "/post ",
    example: "/post Update progres desain katalog #ASLI_RI sudah 90% siap review!",
    mutates: true
  },
  {
    id: "comm_poll",
    command: "/poll",
    category: "Komunikasi & Beranda",
    title: "Buat Polling Resmi di Beranda",
    description: "Luncurkan voting interaktif di Beranda dengan minimal 2 opsi pilihan.",
    template: "/poll [Pertanyaan] | [Opsi 1] | [Opsi 2]",
    example: "/poll Hari terbaik untuk Townhall minggu ini? | Rabu Sore | Jumat Pagi | Kamis Siang",
    mutates: true
  },
  {
    id: "comm_trending",
    command: "/trending",
    category: "Komunikasi & Beranda",
    title: "Analisa Topik Trending Beranda",
    description: "Lacak #hashtag paling populer dan postingan dengan interaksi terbanyak.",
    template: "/trending",
    example: "/trending",
    instant: true
  },
  {
    id: "comm_poll_summary",
    command: "/poll-summary",
    category: "Komunikasi & Beranda",
    title: "Rekap Hasil Seluruh Polling",
    description: "Ringkas pemenang suara dan persentase setiap opsi dari semua polling yang berjalan.",
    template: "/poll-summary",
    example: "/poll-summary",
    instant: true
  },
  {
    id: "comm_announce",
    command: "/announce",
    category: "Komunikasi & Beranda",
    title: "Kirim Pengumuman Internal + Notif",
    description: "Siarkan pengumuman terformat ke Beranda dan kirim notifikasi ke target divisi/seluruh tim.",
    template: "/announce [Semua / Divisi] | [Isi pengumuman]",
    example: "/announce Semua | Pengisian timesheet mingguan maksimal Jumat pukul 17:00 WIB.",
    mutates: true
  },
  {
    id: "comm_dm_draft",
    command: "/dm-draft",
    category: "Komunikasi & Beranda",
    title: "Susun Draf Pesan Profesional",
    description: "Buat draf chat follow-up, koordinasi lintas divisi, atau eskalasi dengan nada sopan.",
    template: "/dm-draft ",
    example: "/dm-draft follow up approval desain ke Pak Direktur dengan sopan"
  },
  {
    id: "comm_chat_recap",
    command: "/chat-recap",
    category: "Komunikasi & Beranda",
    title: "Ringkasan Aktivitas Grup & Chat",
    description: "Pantau grup paling aktif, jumlah percakapan, dan highlight obrolan terkini.",
    template: "/chat-recap",
    example: "/chat-recap",
    instant: true
  },

  // === 6. PROYEK, BRAND & KONTEN (7 fitur) ===
  {
    id: "proj_create",
    command: "/project-create",
    category: "Proyek, Brand & Konten",
    title: "Buat Proyek Baru Langsung",
    description: "Daftarkan proyek baru ke workspace langsung dari jendela asisten.",
    template: "/project-create ",
    example: "/project-create Campaign Ramadan ASLI RI 2027",
    mutates: true
  },
  {
    id: "proj_health",
    command: "/project-health",
    aliases: ["kesehatan proyek"],
    category: "Proyek, Brand & Konten",
    title: "Monitor Kesehatan Proyek (RAG)",
    description: "Evaluasi status Sehat/Waspada/Kritis tiap proyek berdasarkan progress vs keterlambatan.",
    template: "/project-health",
    example: "/project-health",
    instant: true
  },
  {
    id: "proj_brand_report",
    command: "/brand-report",
    category: "Proyek, Brand & Konten",
    title: "Laporan Performa Brand / IP",
    description: "Statistik lengkap tugas aktif, selesai, dan terlambat per brand (ASLI RI, TIXFLY, BANK ABDI, dll).",
    template: "/brand-report",
    example: "/brand-report ASLI RI",
    instant: true
  },
  {
    id: "proj_content_matrix",
    command: "/content-matrix",
    aliases: ["jenis item"],
    category: "Proyek, Brand & Konten",
    title: "Matriks Produksi Jenis Item Konten",
    description: "Sebaran volume produksi Feed Post, Reels, Story, Ads, Deck, Proposal, hingga Research.",
    template: "/content-matrix",
    example: "/content-matrix",
    instant: true
  },
  {
    id: "proj_content_brief",
    command: "/content-brief",
    category: "Proyek, Brand & Konten",
    title: "Generator Brief Kreatif Lengkap",
    description: "Buat kerangka Hook, Key Message, Visual Direction, CTA, dan spesifikasi deliverable konten.",
    template: "/content-brief Reels | ",
    example: "/content-brief Reels | Soft launching fitur cashless TIXFLY"
  },
  {
    id: "proj_caption",
    command: "/caption",
    category: "Proyek, Brand & Konten",
    title: "Generator Copywriting & Caption",
    description: "Hasilkan 3 variasi caption kekinian siap posting untuk Instagram, TikTok, dan LinkedIn.",
    template: "/caption ",
    example: "/caption Promo akhir tahun BANK ABDI untuk UMKM"
  },
  {
    id: "proj_checklist",
    command: "/checklist",
    category: "Proyek, Brand & Konten",
    title: "Generator Checklist SOP Aktivitas",
    description: "Buat template checklist eksekusi standar untuk launch campaign, event, onboarding, atau QA.",
    template: "/checklist ",
    example: "/checklist Launch Produk Baru"
  },

  // === 7. AI PRODUKTIVITAS & BAHASA (6 fitur) ===
  {
    id: "ai_translate",
    command: "/translate",
    category: "AI Produktivitas & Bahasa",
    title: "Penerjemah Bisnis Multi-Bahasa",
    description: "Terjemahkan teks bisnis ke Bahasa Inggris (en), Indonesia (id), Jepang (jp), atau Korea (kr).",
    template: "/translate en | ",
    example: "/translate en | Mohon bantuannya untuk mereview proposal kerjasama terlampir sebelum Jumat."
  },
  {
    id: "ai_polish",
    command: "/polish",
    category: "AI Produktivitas & Bahasa",
    title: "Poles Kalimat Korporat Modern",
    description: "Ubah kalimat santai atau berantakan menjadi bahasa bisnis yang rapi, tegas, dan kekinian.",
    template: "/polish ",
    example: "/polish halo pak ini revisinya udah kelar ya tolong dicek lagi takut ada yg kurang"
  },
  {
    id: "ai_summarize",
    command: "/summarize",
    category: "AI Produktivitas & Bahasa",
    title: "Ringkasan Dokumen & Teks Panjang",
    description: "Ekstrak inti pembahasan, keputusan utama, dan tindak lanjut dari paragraf panjang.",
    template: "/summarize ",
    example: "/summarize Tim produk menyepakati rilis fase 1 ditunda ke Senin depan karena QA payment gateway masih berjalan."
  },
  {
    id: "ai_email",
    command: "/email",
    category: "AI Produktivitas & Bahasa",
    title: "Generator Draf Email Bisnis",
    description: "Susun email penawaran, follow-up klien, permohonan approval, atau laporan mingguan.",
    template: "/email ",
    example: "/email penawaran kerjasama sponsorship event musik untuk brand partner"
  },
  {
    id: "ai_calc",
    command: "/calc",
    category: "AI Produktivitas & Bahasa",
    title: "Kalkulator Bisnis & Metrik Cepat",
    description: "Hitung aritmatika, diskon, margin, PPN, persentase pertumbuhan, dan pembagian budget tim.",
    template: "/calc ",
    example: "/calc 25000000 * 11% + 1500000"
  },
  {
    id: "ai_guide",
    command: "/guide",
    category: "AI Produktivitas & Bahasa",
    title: "Product Knowledge Guide Workspace",
    description: "Panduan lengkap cara memakai fitur Kanban, List, Timeline, Auto Backup, Approval, & Board.",
    template: "/guide",
    example: "/guide backup",
    instant: true
  },

  // === 8. ADMIN, DRIVE & AUDIT (6 fitur) ===
  {
    id: "admin_drive",
    command: "/drive",
    category: "Admin, Drive & Audit",
    title: "Pencari Shortcut Google Drive",
    description: "Temukan link folder Google Drive divisi atau dokumen kerja dengan cepat dari chat.",
    template: "/drive ",
    example: "/drive Marketing",
    instant: true
  },
  {
    id: "admin_audit",
    command: "/audit",
    category: "Admin, Drive & Audit",
    title: "Log Audit & Aktivitas Keamanan",
    description: "Pantau riwayat perubahan penting, audit admin, dan jejak aktivitas workspace terkini.",
    template: "/audit",
    example: "/audit",
    instant: true
  },
  {
    id: "admin_access_pending",
    command: "/access-pending",
    category: "Admin, Drive & Audit",
    title: "Monitor Permintaan Akses & Reset PW",
    description: "Cek antrean akun baru, reset password, atau permintaan approval yang belum diproses.",
    template: "/access-pending",
    example: "/access-pending",
    instant: true
  },
  {
    id: "admin_export_summary",
    command: "/export-summary",
    category: "Admin, Drive & Audit",
    title: "Ringkasan Siap Ekspor (Tabel Eksekutif)",
    description: "Format data kinerja seluruh divisi dalam tabel ringkas siap tempel ke laporan manajemen.",
    template: "/export-summary",
    example: "/export-summary",
    instant: true
  },
  {
    id: "admin_morning_brief",
    command: "/morning-brief",
    aliases: ["/weekly-digest"],
    category: "Admin, Drive & Audit",
    title: "Morning Brief & Digest Eksekutif",
    description: "Briefing komprehensif untuk BoD & Manajer: KPI tugas, risiko telat, agenda, & anggota online.",
    template: "/morning-brief",
    example: "/morning-brief",
    instant: true
  },
  {
    id: "admin_search",
    command: "/search",
    category: "Admin, Drive & Audit",
    title: "Pencarian Global Lintas Modul",
    description: "Cari sekaligus di Task, Karyawan, Proyek, Meeting, Grup Chat, Beranda, dan Drive!",
    template: "/search ",
    example: "/search Marketing"
  },
  {
    id: "admin_help",
    command: "/help",
    category: "Admin, Drive & Audit",
    title: "Daftar Lengkap Perintah Circle",
    description: "Tampilkan katalog perintah cepat yang bisa langsung dijalankan di obrolan Circle.",
    template: "/help",
    example: "/help",
    instant: true
  }
];
