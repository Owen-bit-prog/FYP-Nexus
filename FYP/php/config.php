<?php
// ============================================================
// config.php — FYP Nexus Configuration
// ============================================================

define('DB_HOST',     'localhost');
define('DB_PORT',     '3306');
define('DB_NAME',     'fyp_nexus');
define('DB_USER',     'root');         // Change for production
define('DB_PASS',     '');             // Change for production
define('DB_CHARSET',  'utf8mb4');

define('APP_NAME',    'FYP Nexus');

// Auto-detect APP_URL based on current server request
$protocol = (!empty($_SERVER['HTTPS']) && $_SERVER['HTTPS'] !== 'off') ? 'https://' : 'http://';
$host = $_SERVER['HTTP_HOST'] ?? 'localhost';
$baseUrl = rtrim(dirname($_SERVER['SCRIPT_NAME']), '/\\');
$baseUrl = str_replace('/php', '', $baseUrl);
define('APP_URL', $protocol . $host . $baseUrl);
define('UPLOAD_DIR',  __DIR__ . '/uploads/');
define('MAX_FILE_MB', 50);
define('ALLOWED_EXT', ['pdf','doc','docx','ppt','pptx','xls','xlsx','zip','rar','txt','png','jpg','jpeg']);

define('SESSION_NAME',   'fyp_session');
define('SESSION_EXPIRE', 7200); // 2 hours

// ──────────────────────────────────────────────────────────────
// Database PDO Singleton
// ──────────────────────────────────────────────────────────────
class DB {
    private static ?PDO $pdo = null;

    public static function conn(): PDO {
        if (self::$pdo === null) {
            $dsn = sprintf('mysql:host=%s;port=%s;dbname=%s;charset=%s',
                DB_HOST, DB_PORT, DB_NAME, DB_CHARSET);
            try {
                self::$pdo = new PDO($dsn, DB_USER, DB_PASS, [
                    PDO::ATTR_ERRMODE            => PDO::ERRMODE_EXCEPTION,
                    PDO::ATTR_DEFAULT_FETCH_MODE => PDO::FETCH_ASSOC,
                    PDO::ATTR_EMULATE_PREPARES   => false,
                    PDO::ATTR_TIMEOUT            => 5,
                ]);
            } catch (PDOException $e) {
                http_response_code(500);
                error_log('DB Error: ' . $e->getMessage());
                die(json_encode([
                    'success' => false,
                    'message' => 'Database connection failed',
                    'error' => 'Unable to connect to MySQL. Is the database running?',
                    'debug' => $e->getMessage()
                ]));
            }
        }
        return self::$pdo;
    }

    public static function query(string $sql, array $params = []): PDOStatement {
        $stmt = self::conn()->prepare($sql);
        $stmt->execute($params);
        return $stmt;
    }

    public static function fetch(string $sql, array $params = []): ?array {
        return self::query($sql, $params)->fetch() ?: null;
    }

    public static function fetchAll(string $sql, array $params = []): array {
        return self::query($sql, $params)->fetchAll();
    }

    public static function insert(string $sql, array $params = []): string {
        self::query($sql, $params);
        return self::conn()->lastInsertId();
    }
}

// ──────────────────────────────────────────────────────────────
// Session helpers
// ──────────────────────────────────────────────────────────────
function startAppSession(): void {
    if (session_status() === PHP_SESSION_NONE) {
        session_name(SESSION_NAME);
        session_set_cookie_params([
            'lifetime' => SESSION_EXPIRE,
            'path'     => '/',
            'secure'   => false,  // Set true in production (HTTPS)
            'httponly' => true,
            'samesite' => 'Lax',
        ]);
        session_start();
    }
}

function currentUser(): ?array {
    startAppSession();
    return $_SESSION['user'] ?? null;
}

function requireAuth(string ...$roles): array {
    $user = currentUser();
    if (!$user) {
        jsonResponse(['success' => false, 'message' => 'Unauthenticated', 'redirect' => 'index.html'], 401);
    }
    if ($roles && !in_array($user['role'], $roles, true)) {
        jsonResponse(['success' => false, 'message' => 'Forbidden'], 403);
    }
    return $user;
}

function jsonResponse(array $data, int $code = 200): never {
    http_response_code($code);
    header('Content-Type: application/json');
    echo json_encode($data);
    exit;
}

function sanitize(string $str): string {
    return htmlspecialchars(trim($str), ENT_QUOTES, 'UTF-8');
}

function logActivity(int $userId, ?int $projectId, string $action, string $detail = ''): void {
    DB::insert(
        'INSERT INTO activity_log (user_id, project_id, action, detail) VALUES (?,?,?,?)',
        [$userId, $projectId, $action, $detail]
    );
}

function addNotification(int $userId, string $type, string $title, string $body = '', ?int $refId = null, ?string $refType = null): void {
    DB::insert(
        'INSERT INTO notifications (user_id, type, title, body, ref_id, ref_type) VALUES (?,?,?,?,?,?)',
        [$userId, $type, $title, $body, $refId, $refType]
    );
}
