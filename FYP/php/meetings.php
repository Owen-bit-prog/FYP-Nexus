<?php
// ============================================================
// meetings.php — Schedule, Join, Manage Meetings
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

    case 'get_meetings':
        $meetings = DB::fetchAll(
            'SELECT m.*,
                    o.full_name AS organizer_name, o.avatar_path AS organizer_avatar,
                    p.full_name AS participant_name, p.avatar_path AS participant_avatar,
                    pr.title AS project_title
             FROM meetings m
             JOIN users o  ON o.id = m.organizer_id
             JOIN users p  ON p.id = m.participant_id
             LEFT JOIN projects pr ON pr.id = m.project_id
             WHERE m.organizer_id = ? OR m.participant_id = ?
             ORDER BY m.scheduled_at ASC',
            [$user['id'], $user['id']]
        );
        jsonResponse(['success' => true, 'meetings' => $meetings]);
        break;

    case 'schedule':
        $participantId = (int)($_POST['participant_id'] ?? 0);
        $title         = sanitize($_POST['title']         ?? '');
        $agenda        = sanitize($_POST['agenda']        ?? '');
        $type          = sanitize($_POST['meeting_type']  ?? 'video');
        $scheduledAt   = $_POST['scheduled_at'] ?? '';
        $duration      = (int)($_POST['duration_mins']   ?? 60);
        $projectId     = (int)($_POST['project_id']      ?? 0);

        if (!$participantId || !$title || !$scheduledAt)
            jsonResponse(['success' => false, 'message' => 'Participant, title and date are required.']);

        $roomCode = $type === 'video' ? 'room-' . bin2hex(random_bytes(6)) : null;

        $id = DB::insert(
            'INSERT INTO meetings (project_id, organizer_id, participant_id, title, agenda, meeting_type,
                                   scheduled_at, duration_mins, room_code)
             VALUES (?,?,?,?,?,?,?,?,?)',
            [$projectId ?: null, $user['id'], $participantId, $title, $agenda, $type,
             $scheduledAt, $duration, $roomCode]
        );

        $participant = DB::fetch('SELECT full_name FROM users WHERE id = ?', [$participantId]);
        addNotification(
            $participantId, 'meeting',
            'Meeting Scheduled: ' . $title,
            "{$user['full_name']} scheduled a $type meeting on $scheduledAt.",
            (int)$id, 'meeting'
        );

        logActivity($user['id'], $projectId ?: null, 'meeting_scheduled',
            "Scheduled '$title' with {$participant['full_name']}");

        $meeting = DB::fetch('SELECT * FROM meetings WHERE id = ?', [(int)$id]);
        jsonResponse(['success' => true, 'meeting' => $meeting]);
        break;

    case 'update_status':
        $id     = (int)($_POST['id']     ?? 0);
        $status = sanitize($_POST['status'] ?? '');
        if (!in_array($status, ['scheduled','active','completed','cancelled'], true))
            jsonResponse(['success' => false, 'message' => 'Invalid status.']);
        DB::query('UPDATE meetings SET status=? WHERE id=?', [$status, $id]);
        jsonResponse(['success' => true]);
        break;

    case 'delete':
        $id = (int)($_POST['id'] ?? 0);
        $meeting = DB::fetch('SELECT * FROM meetings WHERE id = ?', [$id]);
        if (!$meeting || $meeting['organizer_id'] !== $user['id'])
            jsonResponse(['success' => false, 'message' => 'Forbidden'], 403);
        DB::query('DELETE FROM meetings WHERE id = ?', [$id]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['success' => false, 'message' => 'Unknown action.'], 400);
}
