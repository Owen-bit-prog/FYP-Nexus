<?php
/*
 * FYP Nexus - System Health Check
 * Visit: http://localhost/fyp_v2/php/health_check.php
 * This script tests all system components
 */

header('Content-Type: application/json');

$checks = [
    'php_version' => phpversion(),
    'timestamp' => date('Y-m-d H:i:s'),
    'components' => []
];

// Check 1: Database Connection
try {
    require_once __DIR__ . '/../config.php';
    $pdo = DB::conn();
    $result = $pdo->query('SELECT 1');
    $checks['components']['database'] = [
        'status' => 'OK',
        'host' => DB_HOST,
        'name' => DB_NAME,
        'message' => 'Database connection successful'
    ];
} catch (Exception $e) {
    $checks['components']['database'] = [
        'status' => 'FAILED',
        'error' => $e->getMessage()
    ];
}

// Check 2: Session System
try {
    if (session_status() === PHP_SESSION_NONE) {
        session_start();
    }
    $checks['components']['session'] = [
        'status' => 'OK',
        'name' => session_name(),
        'message' => 'Session handler working'
    ];
} catch (Exception $e) {
    $checks['components']['session'] = [
        'status' => 'FAILED',
        'error' => $e->getMessage()
    ];
}

// Check 3: Users Table
try {
    $users = DB::fetchAll('SELECT COUNT(*) as count FROM users');
    $count = $users[0]['count'] ?? 0;
    $checks['components']['users_table'] = [
        'status' => 'OK',
        'total_users' => $count,
        'message' => "Users table exists with $count record(s)"
    ];
} catch (Exception $e) {
    $checks['components']['users_table'] = [
        'status' => 'MISSING',
        'error' => 'Users table not found. Run: mysql -u root -p < database_enhanced.sql'
    ];
}

// Check 4: Projects Table
try {
    $projects = DB::fetchAll('SELECT COUNT(*) as count FROM projects');
    $count = $projects[0]['count'] ?? 0;
    $checks['components']['projects_table'] = [
        'status' => 'OK',
        'total_projects' => $count
    ];
} catch (Exception $e) {
    $checks['components']['projects_table'] = [
        'status' => 'MISSING',
        'error' => 'Projects table not found'
    ];
}

// Check 5: File Uploads Directory
$upload_dir = UPLOAD_DIR;
$checks['components']['upload_directory'] = [
    'path' => $upload_dir,
    'exists' => is_dir($upload_dir) ? 'YES' : 'NO',
    'writable' => is_writable($upload_dir) ? 'YES' : 'NO',
    'status' => (is_dir($upload_dir) && is_writable($upload_dir)) ? 'OK' : 'NEEDS FIX'
];

// Check 6: App Configuration
$checks['components']['configuration'] = [
    'app_url' => APP_URL,
    'app_name' => APP_NAME,
    'db_charset' => DB_CHARSET,
    'status' => 'OK'
];

// Overall Status
$all_ok = true;
foreach ($checks['components'] as $component => $data) {
    if (isset($data['status']) && $data['status'] !== 'OK') {
        $all_ok = false;
        break;
    }
}

$checks['overall_status'] = $all_ok ? 'HEALTHY ✓' : 'ISSUES DETECTED ⚠';

// Output
http_response_code($all_ok ? 200 : 500);
echo json_encode($checks, JSON_PRETTY_PRINT | JSON_UNESCAPED_SLASHES);
