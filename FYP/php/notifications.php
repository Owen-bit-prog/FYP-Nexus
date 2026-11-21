<?php
// ============================================================
// notifications.php
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
    case 'get':
        $notifs = DB::fetchAll(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 50',
            [$user['id']]
        );
        $unread = (int)DB::fetch('SELECT COUNT(*) AS c FROM notifications WHERE user_id=? AND is_read=0', [$user['id']])['c'];
        jsonResponse(['success' => true, 'notifications' => $notifs, 'unread' => $unread]);
        break;

    case 'mark_read':
        $id = (int)($_POST['id'] ?? 0);
        if ($id) {
            DB::query('UPDATE notifications SET is_read=1 WHERE id=? AND user_id=?', [$id, $user['id']]);
        } else {
            DB::query('UPDATE notifications SET is_read=1 WHERE user_id=?', [$user['id']]);
        }
        jsonResponse(['success' => true]);
        break;

    case 'clear_all':
        DB::query('DELETE FROM notifications WHERE user_id=?', [$user['id']]);
        jsonResponse(['success' => true]);
        break;

    default:
        jsonResponse(['success' => false, 'message' => 'Unknown action.'], 400);
}
