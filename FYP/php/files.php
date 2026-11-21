<?php
// ============================================================
// files.php — File Upload, Download, Review, Feedback
// ============================================================
require_once __DIR__ . '/config.php';

header('Content-Type: application/json');
header('Access-Control-Allow-Origin: *');
header('Access-Control-Allow-Methods: POST, GET, OPTIONS');
header('Access-Control-Allow-Headers: Content-Type');

if ($_SERVER['REQUEST_METHOD'] === 'OPTIONS') exit(0);

$user   = requireAuth();
$action = $_POST['action'] ?? $_GET['action'] ?? '';

switch ($action) {

    // ── UPLOAD FILE ───────────────────────────────────────
    case 'upload':
        $user = requireAuth('student');

        $projectId  = (int)($_POST['project_id']    ?? 0);
        $title      = sanitize($_POST['title']      ?? '');
        $notes      = sanitize($_POST['notes']      ?? '');
        $subType    = sanitize($_POST['sub_type']   ?? 'other');
        $milestoneId= (int)($_POST['milestone_id']  ?? 0);

        if (!$projectId) jsonResponse(['success' => false, 'message' => 'Project ID required.']);
        if (empty($_FILES['file']['tmp_name'])) jsonResponse(['success' => false, 'message' => 'No file uploaded.']);

        $file    = $_FILES['file'];
        $origName= basename($file['name']);
        $ext     = strtolower(pathinfo($origName, PATHINFO_EXTENSION));
        $sizeMB  = $file['size'] / 1024 / 1024;

        if (!in_array($ext, ALLOWED_EXT, true))
            jsonResponse(['success' => false, 'message' => 'File type not allowed. Allowed: ' . implode(', ', ALLOWED_EXT)]);
        if ($sizeMB > MAX_FILE_MB)
            jsonResponse(['success' => false, 'message' => 'File exceeds maximum size of ' . MAX_FILE_MB . 'MB.']);
        if ($file['error'] !== UPLOAD_ERR_OK)
            jsonResponse(['success' => false, 'message' => 'Upload error code: ' . $file['error']]);

        if (!is_dir(UPLOAD_DIR)) mkdir(UPLOAD_DIR, 0755, true);

        $storedName = 'proj' . $projectId . '_' . time() . '_' . uniqid() . '.' . $ext;
        if (!move_uploaded_file($file['tmp_name'], UPLOAD_DIR . $storedName))
            jsonResponse(['success' => false, 'message' => 'Failed to save file.']);

        $mimeType = mime_content_type(UPLOAD_DIR . $storedName);

        $id = DB::insert(
            'INSERT INTO files (project_id, uploader_id, milestone_id, original_name, stored_name,
                                file_type, file_size, submission_type, title, notes)
             VALUES (?,?,?,?,?,?,?,?,?,?)',
            [
                $projectId, $user['id'],
                $milestoneId ?: null, $origName, $storedName,
                $mimeType, $file['size'], $subType,
                $title ?: $origName, $notes
            ]
        );

        // Notify supervisor
        $project = DB::fetch('SELECT supervisor_id, title AS proj_title FROM projects WHERE id = ?', [$projectId]);
        if ($project && $project['supervisor_id']) {
            addNotification(
                $project['supervisor_id'], 'submission',
                'New Submission: ' . ($title ?: $origName),
                "$user[full_name] submitted a file for '{$project['proj_title']}'.",
                (int)$id, 'file'
            );
        }

        logActivity($user['id'], $projectId, 'file_uploaded', "Uploaded: $origName (" . round($sizeMB, 2) . " MB)");

        $record = DB::fetch('SELECT * FROM files WHERE id = ?', [(int)$id]);
        jsonResponse(['success' => true, 'file' => $record]);
        break;

    // ── GET FILES FOR PROJECT ─────────────────────────────
    case 'get_files':
        $projectId = (int)($_GET['project_id'] ?? 0);
        $files = DB::fetchAll(
            'SELECT f.*, u.full_name AS uploader_name, r.full_name AS reviewer_name
             FROM files f
             JOIN users u ON u.id = f.uploader_id
             LEFT JOIN users r ON r.id = f.reviewed_by
             WHERE f.project_id = ?
             ORDER BY f.created_at DESC',
            [$projectId]
        );
        // Add formatted size
        foreach ($files as &$f) {
            $f['size_fmt'] = $f['file_size']
                ? ($f['file_size'] >= 1048576
                    ? round($f['file_size']/1048576, 2) . ' MB'
                    : round($f['file_size']/1024, 1) . ' KB')
                : '—';
        }
        jsonResponse(['success' => true, 'files' => $files]);
        break;

    // ── GIVE FEEDBACK (Supervisor) ────────────────────────
    case 'review':
        $user = requireAuth('supervisor');

        $fileId  = (int)($_POST['file_id'] ?? 0);
        $status  = sanitize($_POST['status']   ?? '');
        $feedback= sanitize($_POST['feedback'] ?? '');
        $grade   = sanitize($_POST['grade']    ?? '');

        if (!in_array($status, ['approved','revision','rejected'], true))
            jsonResponse(['success' => false, 'message' => 'Invalid review status.']);

        $file = DB::fetch('SELECT * FROM files WHERE id = ?', [$fileId]);
        if (!$file) jsonResponse(['success' => false, 'message' => 'File not found.'], 404);

        DB::query(
            'UPDATE files SET review_status=?, feedback=?, grade=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?',
            [$status, $feedback, $grade, $user['id'], $fileId]
        );

        // Notify student
        $project = DB::fetch('SELECT student_id, title FROM projects WHERE id = ?', [$file['project_id']]);
        if ($project) {
            $statusLabel = ['approved' => 'Approved ✅', 'revision' => 'Needs Revision ⚠️', 'rejected' => 'Rejected ❌'];
            addNotification(
                $project['student_id'], 'feedback',
                'Feedback: ' . $file['title'],
                "Status: {$statusLabel[$status]}. $feedback",
                $fileId, 'file'
            );
        }

        logActivity($user['id'], $file['project_id'], 'feedback_given',
            "Reviewed '{$file['title']}' — Status: $status");

        jsonResponse(['success' => true, 'message' => 'Review submitted.']);
        break;

    // ── DOWNLOAD ──────────────────────────────────────────
    case 'download':
        // Allow download via direct GET (not JSON response)
        $fileId = (int)($_GET['id'] ?? 0);
        $record = DB::fetch('SELECT * FROM files WHERE id = ?', [$fileId]);
        if (!$record) { http_response_code(404); echo 'File not found'; exit; }
        $path = UPLOAD_DIR . $record['stored_name'];
        if (!file_exists($path)) { http_response_code(404); echo 'File missing on disk'; exit; }

        header('Content-Type: ' . ($record['file_type'] ?: 'application/octet-stream'));
        header('Content-Disposition: attachment; filename="' . $record['original_name'] . '"');
        header('Content-Length: ' . filesize($path));
        readfile($path);
        exit;

    // ── DELETE FILE ───────────────────────────────────────
    case 'delete':
        $fileId = (int)($_POST['id'] ?? 0);
        $record = DB::fetch('SELECT * FROM files WHERE id = ?', [$fileId]);
        if (!$record) jsonResponse(['success' => false, 'message' => 'File not found.'], 404);
        if ($user['role'] === 'student' && $record['uploader_id'] !== $user['id'])
            jsonResponse(['success' => false, 'message' => 'Forbidden'], 403);

        @unlink(UPLOAD_DIR . $record['stored_name']);
        DB::query('DELETE FROM files WHERE id = ?', [$fileId]);
        logActivity($user['id'], $record['project_id'], 'file_deleted', "Deleted: {$record['original_name']}");

        jsonResponse(['success' => true]);
        break;

    // ── SUPERVISOR: PENDING SUBMISSIONS ───────────────────
    case 'supervisor_pending':
        $user = requireAuth('supervisor');
        $files = DB::fetchAll(
            'SELECT f.*, p.title AS project_title, u.full_name AS student_name,
                    u.student_id AS student_number, u.avatar_path AS student_avatar
             FROM files f
             JOIN projects p ON p.id = f.project_id
             JOIN users u ON u.id = f.uploader_id
             WHERE p.supervisor_id = ?
               AND (f.review_status IS NULL OR f.review_status = "pending")
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

    // ── SUPERVISOR: REVIEWED SUBMISSIONS ──────────────────
    case 'supervisor_reviewed':
        $user = requireAuth('supervisor');
        $files = DB::fetchAll(
            'SELECT f.*, p.title AS project_title, u.full_name AS student_name,
                    u.student_id AS student_number
             FROM files f
             JOIN projects p ON p.id = f.project_id
             JOIN users u ON u.id = f.uploader_id
             WHERE p.supervisor_id = ?
               AND f.review_status IS NOT NULL
               AND f.review_status != "pending"
             ORDER BY f.reviewed_at DESC',
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

    // ── SUPERVISOR: REVIEW/FEEDBACK (alias for 'review') ──
    case 'review_file':
        $user     = requireAuth('supervisor');
        $fileId   = (int)($_POST['file_id'] ?? 0);
        $status   = sanitize($_POST['decision'] ?? $_POST['status'] ?? '');
        $feedback = sanitize($_POST['feedback'] ?? '');
        $grade    = sanitize($_POST['grade']    ?? '');

        if (!in_array($status, ['approved','revision','rejected'], true))
            jsonResponse(['success' => false, 'message' => 'Invalid review status.']);

        $file = DB::fetch('SELECT * FROM files WHERE id = ?', [$fileId]);
        if (!$file) jsonResponse(['success' => false, 'message' => 'File not found.'], 404);

        // Verify supervisor owns this project
        $project = DB::fetch('SELECT * FROM projects WHERE id = ? AND supervisor_id = ?',
            [$file['project_id'], $user['id']]);
        if (!$project) jsonResponse(['success' => false, 'message' => 'Forbidden'], 403);

        DB::query(
            'UPDATE files SET review_status=?, feedback=?, grade=?, reviewed_by=?, reviewed_at=NOW() WHERE id=?',
            [$status, $feedback, $grade, $user['id'], $fileId]
        );

        $labels = ['approved' => 'Approved ✅', 'revision' => 'Needs Revision ⚠️', 'rejected' => 'Rejected ❌'];
        addNotification(
            $project['student_id'], 'feedback',
            'Feedback: ' . $file['title'],
            "Status: {$labels[$status]}." . ($feedback ? " $feedback" : ''),
            $fileId, 'file'
        );

        logActivity($user['id'], $file['project_id'], 'feedback_given',
            "Reviewed '{$file['title']}' — Status: $status");

        jsonResponse(['success' => true, 'message' => 'Review submitted.']);
        break;

    // ── ALL FILES FOR ADMIN ────────────────────────────────
    case 'get_all_files':
        requireAuth('admin');
        $projectId = (int)($_GET['project_id'] ?? 0);
        $where = $projectId ? 'WHERE f.project_id = ?' : '';
        $params = $projectId ? [$projectId] : [];
        $files = DB::fetchAll(
            "SELECT f.*, p.title AS project_title, u.full_name AS student_name,
                    r.full_name AS reviewer_name
             FROM files f
             JOIN projects p ON p.id = f.project_id
             JOIN users u ON u.id = f.uploader_id
             LEFT JOIN users r ON r.id = f.reviewed_by
             $where ORDER BY f.created_at DESC LIMIT 200",
            $params
        );
        jsonResponse(['success' => true, 'files' => $files]);
        break;

    default:
        jsonResponse(['success' => false, 'message' => 'Unknown action.'], 400);
}
