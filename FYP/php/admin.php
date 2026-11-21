<?php
// ============================================================
// admin.php — FYP Nexus Admin API
// Handles: user management, supervisor assignment, system stats
// ============================================================
require_once __DIR__ . '/config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

$user   = requireAuth('admin');
$action = $_POST['action'] ?? $_GET['action'] ?? '';

switch ($action) {

    // ── GET ALL USERS ─────────────────────────────────────
    case 'get_users':
        $role = isset($_GET['role']) ? $_GET['role'] : null;
        if ($role && in_array($role, ['student','supervisor','admin'], true)) {
            $users = DB::fetchAll(
                'SELECT id, full_name, email, role, student_id, department, phone, is_online, last_seen, created_at
                 FROM users WHERE role = ? ORDER BY created_at DESC',
                [$role]
            );
        } else {
            $users = DB::fetchAll(
                'SELECT id, full_name, email, role, student_id, department, phone, is_online, last_seen, created_at
                 FROM users ORDER BY created_at DESC'
            );
        }
        jsonResponse(['success' => true, 'users' => $users]);
        break;

    // ── GET SINGLE USER ───────────────────────────────────
    case 'get_user':
        $id = (int)($_GET['user_id'] ?? 0);
        $u = DB::fetch('SELECT id, full_name, email, role, student_id, department, phone, bio, is_online, created_at FROM users WHERE id=?', [$id]);
        if (!$u) jsonResponse(['success' => false, 'message' => 'User not found.'], 404);
        jsonResponse(['success' => true, 'user' => $u]);
        break;

    // ── UPDATE USER ───────────────────────────────────────
    case 'update_user':
        $userId = (int)($_POST['user_id'] ?? 0);
        $name   = sanitize($_POST['full_name']   ?? '');
        $dept   = sanitize($_POST['department']  ?? '');
        $role   = $_POST['role'] ?? '';
        $newPass = $_POST['new_password'] ?? '';

        if (!$userId || !$name) jsonResponse(['success' => false, 'message' => 'User ID and name required.']);
        if (!in_array($role, ['student','supervisor','admin'], true)) {
            jsonResponse(['success' => false, 'message' => 'Invalid role.']);
        }

        DB::query(
            'UPDATE users SET full_name=?, department=?, role=?, updated_at=NOW() WHERE id=?',
            [$name, $dept, $role, $userId]
        );

        if ($newPass) {
            if (strlen($newPass) < 8) jsonResponse(['success' => false, 'message' => 'Password must be at least 8 characters.']);
            $hash = password_hash($newPass, PASSWORD_BCRYPT, ['cost' => 12]);
            DB::query('UPDATE users SET password_hash=? WHERE id=?', [$hash, $userId]);
        }

        logActivity($user['id'], null, 'update_user', "Updated user ID $userId");
        jsonResponse(['success' => true]);
        break;

    // ── DELETE USER ───────────────────────────────────────
    case 'delete_user':
        $userId = (int)($_POST['user_id'] ?? 0);
        if (!$userId) jsonResponse(['success' => false, 'message' => 'User ID required.']);
        if ($userId === $user['id']) jsonResponse(['success' => false, 'message' => 'Cannot delete yourself.']);

        DB::query('DELETE FROM users WHERE id=?', [$userId]);
        logActivity($user['id'], null, 'delete_user', "Deleted user ID $userId");
        jsonResponse(['success' => true]);
        break;

    // ── ASSIGN SUPERVISOR ─────────────────────────────────
    case 'assign_supervisor':
        $projectId    = (int)($_POST['project_id']    ?? 0);
        $supervisorId = (int)($_POST['supervisor_id'] ?? 0);

        if (!$projectId || !$supervisorId) {
            jsonResponse(['success' => false, 'message' => 'Project ID and Supervisor ID required.']);
        }

        // Verify supervisor exists and has correct role
        $sup = DB::fetch('SELECT id, full_name FROM users WHERE id=? AND role=?', [$supervisorId, 'supervisor']);
        if (!$sup) jsonResponse(['success' => false, 'message' => 'Supervisor not found.']);

        $project = DB::fetch('SELECT id, title, student_id FROM projects WHERE id=?', [$projectId]);
        if (!$project) jsonResponse(['success' => false, 'message' => 'Project not found.']);

        DB::query(
            'UPDATE projects SET supervisor_id=?, status=IF(status="pending","active",status), updated_at=NOW() WHERE id=?',
            [$supervisorId, $projectId]
        );

        // Notify student and supervisor
        addNotification(
            $project['student_id'], 'assignment',
            'Supervisor Assigned',
            "Dr./Mr./Ms. {$sup['full_name']} has been assigned as your supervisor.",
            $projectId, 'project'
        );
        addNotification(
            $supervisorId, 'assignment',
            'New Student Assigned',
            "You have been assigned to supervise project: {$project['title']}.",
            $projectId, 'project'
        );

        logActivity($user['id'], $projectId, 'assign_supervisor', "Assigned supervisor ID $supervisorId to project ID $projectId");
        jsonResponse(['success' => true]);
        break;

    // ── UNASSIGN SUPERVISOR ────────────────────────────────
    case 'unassign_supervisor':
        $projectId = (int)($_POST['project_id'] ?? 0);
        if (!$projectId) jsonResponse(['success' => false, 'message' => 'Project ID required.']);

        DB::query('UPDATE projects SET supervisor_id=NULL, updated_at=NOW() WHERE id=?', [$projectId]);
        logActivity($user['id'], $projectId, 'unassign_supervisor', "Removed supervisor from project ID $projectId");
        jsonResponse(['success' => true]);
        break;

    // ── GET ACTIVITY LOG ──────────────────────────────────
    case 'get_activity':
        $filter = $_GET['filter'] ?? 'all';
        $limit  = (int)($_GET['limit'] ?? 100);
        if ($limit < 1 || $limit > 500) $limit = 100;

        $sql = 'SELECT al.*, u.full_name AS user_name, u.role AS user_role
                FROM activity_log al
                LEFT JOIN users u ON u.id = al.user_id';

        $params = [];
        if ($filter !== 'all') {
            $sql .= ' WHERE al.action LIKE ?';
            $params[] = '%' . $filter . '%';
        }

        $sql .= ' ORDER BY al.created_at DESC LIMIT ' . $limit;
        $activity = DB::fetchAll($sql, $params);
        jsonResponse(['success' => true, 'activity' => $activity]);
        break;

    // ── SYSTEM STATS ──────────────────────────────────────
    case 'get_stats':
        $stats = [
            'total_users'       => DB::fetch('SELECT COUNT(*) AS n FROM users')['n'],
            'total_students'    => DB::fetch('SELECT COUNT(*) AS n FROM users WHERE role="student"')['n'],
            'total_supervisors' => DB::fetch('SELECT COUNT(*) AS n FROM users WHERE role="supervisor"')['n'],
            'total_projects'    => DB::fetch('SELECT COUNT(*) AS n FROM projects')['n'],
            'active_projects'   => DB::fetch('SELECT COUNT(*) AS n FROM projects WHERE status="active"')['n'],
            'completed_projects'=> DB::fetch('SELECT COUNT(*) AS n FROM projects WHERE status="completed"')['n'],
            'unassigned_projects'=>DB::fetch('SELECT COUNT(*) AS n FROM projects WHERE supervisor_id IS NULL')['n'],
            'total_files'       => DB::fetch('SELECT COUNT(*) AS n FROM files')['n'],
            'pending_reviews'   => DB::fetch('SELECT COUNT(*) AS n FROM files WHERE review_status="pending"')['n'],
            'total_messages'    => DB::fetch('SELECT COUNT(*) AS n FROM messages')['n'],
            'total_meetings'    => DB::fetch('SELECT COUNT(*) AS n FROM meetings')['n'],
        ];
        jsonResponse(['success' => true, 'stats' => $stats]);
        break;

    // ── GET SUPERVISORS ───────────────────────────────────
    case 'get_supervisors':
        $supervisors = DB::fetchAll(
            'SELECT u.id, u.full_name, u.email, u.department, u.is_online,
                    COUNT(p.id) AS student_count
             FROM users u
             LEFT JOIN projects p ON p.supervisor_id = u.id
             WHERE u.role = "supervisor"
             GROUP BY u.id
             ORDER BY u.full_name ASC'
        );
        jsonResponse(['success' => true, 'supervisors' => $supervisors]);
        break;

    default:
        jsonResponse(['success' => false, 'message' => 'Unknown action.'], 400);
}
