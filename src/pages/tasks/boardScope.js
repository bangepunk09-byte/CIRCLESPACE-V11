export function getHumanUsers(users = []) {
  return (users || []).filter(
    (u) => u && !u.is_bot && u.role !== "assistant" && u.user_id !== "user_circle_assistant"
  );
}

export function isBoardCollaborative(board) {
  if (!board) return false;
  const deptLower = String(board.department || "").trim().toLowerCase();
  return Boolean(
    board.is_collaborative ||
    board.board_type === "collaborative" ||
    board.board_type === "project" ||
    board.project_id ||
    !deptLower ||
    deptLower === "semua divisi" ||
    deptLower === "all" ||
    deptLower === "kolaborasi" ||
    deptLower === "project" ||
    board.id === "brd_div_project"
  );
}

export function getBoardAssigneeScope({
  board = null,
  boards = [],
  boardId = "",
  projectId = "",
  department = "",
  users = []
} = {}) {
  const humanUsers = getHumanUsers(users);
  const humanIds = humanUsers.map((u) => u.user_id);

  const activeBoard = board || (boards || []).find((b) => b.id === boardId) || null;
  const rawDept = activeBoard ? (activeBoard.department || "") : (department || "");
  const cleanDept = String(rawDept).trim();
  const deptLower = cleanDept.toLowerCase();
  const hasProject = Boolean(projectId || activeBoard?.project_id);
  const boardCollab = isBoardCollaborative(activeBoard);
  const isCollaborative = Boolean(boardCollab || hasProject);

  if (isCollaborative) {
    let ids = humanIds;
    if (
      activeBoard &&
      activeBoard.all_workspace_members === false &&
      Array.isArray(activeBoard.member_ids) &&
      activeBoard.member_ids.length > 0
    ) {
      const allowedSet = new Set([
        ...(activeBoard.member_ids || []),
        ...(activeBoard.invited_member_ids || [])
      ]);
      ids = humanUsers.filter((u) => allowedSet.has(u.user_id)).map((u) => u.user_id);
    }
    return {
      ids,
      isCollaborative: true,
      activeBoard,
      divisionName: cleanDept && deptLower !== "semua divisi" ? cleanDept : "Lintas Divisi",
      scopeLabel: hasProject && !boardCollab
        ? "Mode Proyek Kolaborasi · Lintas divisi"
        : "Board Kolaborasi / Proyek · Dapat memilih anggota lintas divisi",
      emptyMessage: "Belum ada kolaborator yang ditambahkan ke board ini."
    };
  }

  if (cleanDept) {
    const deptIds = humanUsers
      .filter((u) => String(u.department || "").trim().toLowerCase() === deptLower)
      .map((u) => u.user_id);

    return {
      ids: deptIds,
      isCollaborative: false,
      activeBoard,
      divisionName: cleanDept,
      scopeLabel: `Khusus anggota divisi ${cleanDept} · Gunakan Board Kolaborasi untuk lintas divisi`,
      emptyMessage: `Belum ada akun di divisi ${cleanDept}.`
    };
  }

  return {
    ids: humanIds,
    isCollaborative: true,
    activeBoard,
    divisionName: "Semua Divisi",
    scopeLabel: "Pilih board divisi untuk membatasi anggota per divisi",
    emptyMessage: "Belum ada anggota tersedia."
  };
}
