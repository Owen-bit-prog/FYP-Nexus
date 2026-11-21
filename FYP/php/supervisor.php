<?php
// ============================================================
// supervisor.php — Supervisor Dashboard API
// Features: Students overview, Submissions, Feedback, Grading
// ============================================================
require_once __DIR__ . '/config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

$user   = requireAuth('supervisor');
$action = $_POST['action'] ?? $_GET['action'] ?? '';

switch ($action) {

    // ── GET ALL MY STUDENTS ─────────────────────────────────
    case 'get_students':
        $students = DB::fetchAll(
            'SELECT DISTINCT
                u.id, u.full_name, u.email, u.student_id, u.department,
                u.is_online, u.avatar_path,
                COUNT(DISTINCT p.id) AS project_count
             FROM users u
             INNER JOIN projects p ON p.student_id = u.id
             WHERE p.supervisor_id = ? AND u.role = "student"
             GROUP BY u.id
             ORDER BY u.full_name',
            [$user['id']]
        );
        jsonResponse(['success' => true, 'students' => $students]);
        break;

    // ── GET ALL MY PROJECTS OVERVIEW ────────────────────────
    case 'get_projects_overview':
        $projects = DB::fetchAll(
            'SELECT 
                p.id, p.title, p.status, p.progress, p.overall_grade, p.final_score,
                p.deadline, p.created_at, p.updated_at,
                u.id AS student_id, u.full_name AS student_name, u.email AS student_email,
                u.student_id AS student_number, u.is_online AS student_online,
                COUNT(DISTINCT m.id) AS total_milestones,
                COUNT(DISTINCT CASE WHEN m.status = "completed" THEN m.id END) AS completed_milestones,
                COUNT(DISTINCT f.id) AS total_submissions,
                COUNT(DISTINCT CASE WHEN f.review_status = "pending" THEN f.id END) AS pending_submissions,
                AVG(sg.score) AS average_score
             FROM projects p
             JOIN users u ON p.student_id = u.id
             LEFT JOIN milestones m ON p.id = m.project_id
             LEFT JOIN files f ON p.id = f.project_id
             LEFT JOIN submission_grades sg ON f.id = sg.file_id
             WHERE p.supervisor_id = ?
             GROUP BY p.id
             ORDER BY p.updated_at DESC',
            [$user['id']]
        );
        jsonResponse(['success' => true, 'projects' => $projects]);
        break;

    // ── GET ALL PENDING SUBMISSIONS (SUPERVISOR VIEW) ──────
    case 'supervisor_pending':
        $files = DB::fetchAll(
            'SELECT f.*, u.full_name AS student_name, u.email AS student_email,
                    p.id AS project_id, p.title AS project_title
             FROM files f
             JOIN projects p ON f.project_id = p.id
             JOIN users u ON p.student_id = u.id
             WHERE p.supervisor_id = ? AND f.review_status = "pending"
             ORDER BY f.created_at DESC',
            [$user['id']]
        );
        foreach ($files as &$f) {
            $f['size_fmt'] = $f['file_size']
                ? ($f['file_size'] >= 1048576
                    ? round($f['file_size']/1048576, 2) . ' MB'
                    : round($f['file_size']/1024, 1) . ' KB')
                : '—';
        }
        jsonResponse(['success' => true, 'files' => $files]);
        break;

    // ── GET PROJECT DETAIL WITH ALL SUBMISSIONS ────────────
    case 'get_project_detail':
        $projectId = (int)($_GET['project_id'] ?? $_POST['project_id'] ?? 0);
        
        $project = DB::fetch(
            'SELECT p.*, u.full_name AS student_name, u.email AS student_email,
                    u.student_id AS student_number, u.department AS student_dept,
                    u.avatar_path AS student_avatar
             FROM projects p
             JOIN users u ON p.student_id = u.id
             WHERE p.id = ? AND p.supervisor_id = ?',
            [$projectId, $user['id']]
        );

        if (!$project) {
            jsonResponse(['success' => false, 'message' => 'Project not found or access denied.'], 403);
        }

        // Get all submissions
        $submissions = DB::fetchAll(
            'SELECT f.*, sg.score, sg.comments
             FROM files f
             LEFT JOIN submission_grades sg ON f.id = sg.file_id
             WHERE f.project_id = ?
             ORDER BY f.created_at DESC',
            [$projectId]
        );

        foreach ($submissions as &$s) {
            $s['size_fmt'] = $s['file_size']
                ? ($s['file_size'] >= 1048576
                    ? round($s['file_size']/1048576, 2) . ' MB'
                    : round($s['file_size']/1024, 1) . ' KB')
                : '—';
        }

        // Get milestones
        $milestones = DB::fetchAll(
            'SELECT * FROM milestones WHERE project_id = ? ORDER BY order_num',
            [$projectId]
        );

        jsonResponse([
            'success' => true,
            'project' => $project,
            'submissions' => $submissions,
            'milestones' => $milestones
        ]);
        break;

    // ── GIVE FEEDBACK ON SUBMISSION ────────────────────────
    case 'give_feedback':
        $user = requireAuth('supervisor');
        $fileId     = (int)($_POST['file_id']      ?? 0);
        $feedback   = sanitize($_POST['feedback']   ?? '');
        $status     = sanitize($_POST['status']     ?? 'pending');
        $grade      = sanitize($_POST['grade']      ?? '');
        $score      = (float)($_POST['score']       ?? 0);

        if (!$fileId || !in_array($status, ['pending', 'approved', 'revision', 'rejected'], true)) {
            jsonResponse(['success' => false, 'message' => 'Invalid request.']);
        }

        // Verify ownership
        $file = DB::fetch(
            'SELECT f.*, p.supervisor_id FROM files f 
             JOIN projects p ON f.project_id = p.id 
             WHERE f.id = ?',
            [$fileId]
        );

        if (!$file || $file['supervisor_id'] != $user['id']) {
            jsonResponse(['success' => false, 'message' => 'Access denied.'], 403);
        }

        // Update file
        DB::query(
            'UPDATE files SET review_status = ?, feedback = ?, grade = ?, reviewed_by = ?, reviewed_at = NOW()
             WHERE id = ?',
            [$status, $feedback, $grade ?: null, $user['id'], $fileId]
        );

        // Create/update grade record
        $existing = DB::fetch('SELECT id FROM submission_grades WHERE file_id = ?', [$fileId]);
        
        if ($existing) {
            DB::query(
                'UPDATE submission_grades SET score = ?, grade = ?, comments = ?, graded_at = NOW()
                 WHERE file_id = ?',
                [$score, $grade ?: null, $feedback, $fileId]
            );
        } else {
            DB::insert(
                'INSERT INTO submission_grades (file_id, supervisor_id, score, grade, comments)
                 VALUES (?, ?, ?, ?, ?)',
                [$fileId, $user['id'], $score, $grade ?: null, $feedback]
            );
        }

        // Notify student
        $file = DB::fetch('SELECT uploader_id FROM files WHERE id = ?', [$fileId]);
        if ($file) {
            $statusText = ['approved' => 'Approved', 'revision' => 'Needs Revision', 'rejected' => 'Rejected', 'pending' => 'Pending'];
            addNotification(
                $file['uploader_id'], 'feedback',
                'Submission Reviewed',
                "Your submission has been reviewed: " . ($statusText[$status] ?? $status),
                $fileId, 'file'
            );
        }

        logActivity($user['id'], $file['project_id'] ?? null, 'feedback_given', "Reviewed file #$fileId — Status: $status, Grade: $grade");

        jsonResponse(['success' => true, 'message' => 'Feedback submitted.']);
        break;

    // ── GIVE OVERALL PROJECT GRADE ──────────────────────────
    case 'grade_project':
        $user = requireAuth('supervisor');
        $projectId  = (int)($_POST['project_id']    ?? 0);
        $overallGrade = sanitize($_POST['grade']      ?? '');
        $finalScore = (float)($_POST['score']       ?? 0);
        $comments   = sanitize($_POST['comments']   ?? '');

        $project = DB::fetch('SELECT id FROM projects WHERE id = ? AND supervisor_id = ?', [$projectId, $user['id']]);
        if (!$project) {
            jsonResponse(['success' => false, 'message' => 'Project not found or access denied.'], 403);
        }

        DB::query(
            'UPDATE projects SET overall_grade = ?, final_score = ?, updated_at = NOW()
             WHERE id = ?',
            [$overallGrade ?: null, $finalScore, $projectId]
        );

        logActivity($user['id'], $projectId, 'project_graded', "Overall Grade: $overallGrade, Score: $finalScore");

        jsonResponse(['success' => true, 'message' => 'Project grade updated.']);
        break;

    // ── GET PROPOSALS PENDING APPROVAL ──────────────────────
    case 'get_proposals':
        $proposals = DB::fetchAll(
            'SELECT f.*, u.full_name AS student_name, p.id AS project_id, p.title AS project_title
             FROM files f
             JOIN projects p ON f.project_id = p.id
             JOIN users u ON p.student_id = u.id
             WHERE p.supervisor_id = ? AND f.submission_type = "proposal"
             ORDER BY f.created_at DESC',
            [$user['id']]
        );
        jsonResponse(['success' => true, 'proposals' => $proposals]);
        break;

    // ── GET FEEDBACK HISTORY ────────────────────────────────
    case 'get_feedback_given':
        $projectId = (int)($_GET['project_id'] ?? 0);
        $query = 'SELECT f.id, f.title, f.created_at, f.submission_type, 
                         f.review_status, sg.score, sg.grade, sg.comments,
                         u.full_name AS student_name
                  FROM files f
                  LEFT JOIN submission_grades sg ON f.id = sg.file_id
                  JOIN projects p ON f.project_id = p.id
                  JOIN users u ON p.student_id = u.id
                  WHERE p.supervisor_id = ?';
        $params = [$user['id']];

        if ($projectId) {
            $query .= ' AND p.id = ?';
            $params[] = $projectId;
        }

        $query .= ' AND sg.id IS NOT NULL ORDER BY f.created_at DESC';
        
        $feedback = DB::fetchAll($query, $params);
        jsonResponse(['success' => true, 'feedback' => $feedback]);
        break;

    // ── GET STATISTICS ──────────────────────────────────────
    case 'get_stats':
        $stats = DB::fetch(
            'SELECT 
                COUNT(DISTINCT p.id) AS total_students,
                COUNT(DISTINCT CASE WHEN p.status = "active" THEN p.id END) AS active_projects,
                COUNT(DISTINCT CASE WHEN f.review_status = "pending" THEN f.id END) AS pending_submissions,
                COUNT(DISTINCT CASE WHEN m.scheduled_at > NOW() AND m.status = "scheduled" THEN m.id END) AS upcoming_meetings,
                AVG(sg.score) AS average_student_score
             FROM users u
             LEFT JOIN projects p ON p.supervisor_id = u.id AND u.id = ?
             LEFT JOIN files f ON p.id = f.project_id
             LEFT JOIN meetings m ON p.id = m.project_id AND u.id = m.organizer_id
             LEFT JOIN submission_grades sg ON f.id = sg.file_id',
            [$user['id']]
        );
        jsonResponse(['success' => true, 'stats' => $stats]);
        break;

    default:
        jsonResponse(['success' => false, 'message' => 'Unknown action.'], 400);
}
?>
