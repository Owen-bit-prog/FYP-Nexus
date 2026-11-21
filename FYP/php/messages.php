<?php
// ============================================================
// messages.php — Real-time Messaging (polling-based)
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

    case 'send':
        $receiverId = (int)($_POST['receiver_id'] ?? 0);
        $body       = sanitize($_POST['body'] ?? '');
        $projectId  = (int)($_POST['project_id'] ?? 0);

        if (!$receiverId || !$body)
            jsonResponse(['success' => false, 'message' => 'Receiver and message body required.']);

        $id = DB::insert(
            'INSERT INTO messages (project_id, sender_id, receiver_id, body) VALUES (?,?,?,?)',
            [$projectId ?: null, $user['id'], $receiverId, $body]
        );

        addNotification($receiverId, 'message', 'New message from ' . $user['full_name'], $body);
        logActivity($user['id'], $projectId ?: null, 'message_sent', "To user #$receiverId");

        $msg = DB::fetch(
            'SELECT m.*, u.full_name AS sender_name, u.role AS sender_role, u.avatar_path AS sender_avatar
             FROM messages m JOIN users u ON u.id = m.sender_id WHERE m.id = ?',
            [(int)$id]
        );
        jsonResponse(['success' => true, 'message' => $msg]);
        break;

    case 'get_thread':
        $otherId   = (int)($_GET['user_id']    ?? 0);
        $projectId = (int)($_GET['project_id'] ?? 0);
        $since     = (int)($_GET['since']      ?? 0); // last message id for polling

        $whereExtra = $projectId ? 'AND m.project_id = ?' : '';
        $params = [$user['id'], $otherId, $otherId, $user['id']];
        if ($projectId) $params[] = $projectId;
        if ($since) { $whereExtra .= ' AND m.id > ?'; $params[] = $since; }

        $messages = DB::fetchAll(
            "SELECT m.*, u.full_name AS sender_name, u.role AS sender_role, u.avatar_path AS sender_avatar
             FROM messages m
             JOIN users u ON u.id = m.sender_id
             WHERE ((m.sender_id = ? AND m.receiver_id = ?) OR (m.sender_id = ? AND m.receiver_id = ?))
             $whereExtra
             ORDER BY m.created_at ASC LIMIT 200",
            $params
        );

        // Mark as read
        DB::query(
            'UPDATE messages SET is_read=1 WHERE receiver_id=? AND sender_id=? AND is_read=0',
            [$user['id'], $otherId]
        );

        jsonResponse(['success' => true, 'messages' => $messages]);
        break;

    case 'get_contacts':
        // People user has conversations with
        $contacts = DB::fetchAll(
            'SELECT DISTINCT
                u.id, u.full_name, u.role, u.is_online, u.avatar_path, u.department,
                (SELECT body FROM messages WHERE (sender_id=u.id AND receiver_id=?) OR (sender_id=? AND receiver_id=u.id) ORDER BY created_at DESC LIMIT 1) AS last_message,
                (SELECT COUNT(*) FROM messages WHERE sender_id=u.id AND receiver_id=? AND is_read=0) AS unread_count,
                (SELECT created_at FROM messages WHERE (sender_id=u.id AND receiver_id=?) OR (sender_id=? AND receiver_id=u.id) ORDER BY created_at DESC LIMIT 1) AS last_at
             FROM users u
             WHERE u.id != ? AND u.role != "admin"
               AND EXISTS (
                 SELECT 1 FROM messages WHERE (sender_id=u.id AND receiver_id=?) OR (sender_id=? AND receiver_id=u.id)
               )
             ORDER BY last_at DESC',
            [$user['id'],$user['id'],$user['id'],$user['id'],$user['id'],$user['id'],$user['id'],$user['id']]
        );

        // If student/supervisor — also add their paired partner even with no messages yet
        if ($user['role'] === 'student') {
            $projs = DB::fetchAll(
                'SELECT u.id, u.full_name, u.role, u.is_online, u.avatar_path, u.department
                 FROM projects p JOIN users u ON u.id = p.supervisor_id
                 WHERE p.student_id = ? AND p.supervisor_id IS NOT NULL', [$user['id']]
            );
        } else {
            $projs = DB::fetchAll(
                'SELECT u.id, u.full_name, u.role, u.is_online, u.avatar_path, u.department
                 FROM projects p JOIN users u ON u.id = p.student_id
                 WHERE p.supervisor_id = ?', [$user['id']]
            );
        }

        $contactIds = array_column($contacts, 'id');
        foreach ($projs as $p) {
            if (!in_array($p['id'], $contactIds, true)) {
                $p['last_message'] = null;
                $p['unread_count'] = 0;
                $p['last_at']      = null;
                $contacts[] = $p;
            }
        }

        jsonResponse(['success' => true, 'contacts' => $contacts]);
        break;

    case 'unread_count':
        $count = DB::fetch('SELECT COUNT(*) AS c FROM messages WHERE receiver_id=? AND is_read=0', [$user['id']]);
        jsonResponse(['success' => true, 'count' => (int)$count['c']]);
        break;

    default:
        jsonResponse(['success' => false, 'message' => 'Unknown action.'], 400);
}
