<?php
/*
 * Password Hash Generator for FYP Nexus
 * This tool generates bcrypt hashes for database user passwords
 * To insert a new user securely, use a hash from this tool
 * 
 * Usage: Visit http://localhost/fyp_v2/php/hash_generator.php in browser
 * Then copy the generated hash and paste to database users.password_hash field
 */

// Get password from URL query or POST
$password = $_GET['pass'] ?? $_POST['pass'] ?? '';
$hash = '';
$error = '';

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !empty($password)) {
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
} elseif (!empty($password)) {
    $hash = password_hash($password, PASSWORD_BCRYPT, ['cost' => 12]);
}

if (!empty($password) && empty($hash)) {
    $error = 'Error generating hash. Check PHP installation.';
}

?><!DOCTYPE html>
<html>
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>FYP Nexus - Password Hash Generator</title>
    <style>
        * { margin: 0; padding: 0; box-sizing: border-box; }
        body {
            font-family: 'Lato', sans-serif;
            background: #0e1117;
            color: #dde4f0;
            display: flex;
            align-items: center;
            justify-content: center;
            min-height: 100vh;
            padding: 20px;
        }
        .container {
            background: #1a2133;
            border: 1px solid rgba(232,168,56,0.3);
            border-radius: 12px;
            padding: 40px;
            max-width: 500px;
            width: 100%;
            box-shadow: 0 8px 24px rgba(0,0,0,0.3);
        }
        h1 {
            font-size: 24px;
            margin-bottom: 10px;
            color: #e8a838;
            font-weight: 700;
        }
        .desc {
            color: #8896b0;
            margin-bottom: 30px;
            font-size: 14px;
            line-height: 1.6;
        }
        .form-group {
            margin-bottom: 20px;
        }
        label {
            display: block;
            font-size: 12px;
            font-weight: 700;
            color: #8896b0;
            text-transform: uppercase;
            letter-spacing: 0.5px;
            margin-bottom: 8px;
        }
        input[type="password"],
        input[type="text"] {
            width: 100%;
            padding: 12px 14px;
            background: #0e1117;
            border: 1px solid rgba(255,255,255,0.07);
            border-radius: 8px;
            color: #dde4f0;
            font-family: monospace;
            font-size: 13px;
            outline: none;
            transition: border-color 0.2s;
        }
        input[type="password"]:focus,
        input[type="text"]:focus {
            border-color: #e8a838;
        }
        .btn {
            width: 100%;
            padding: 12px;
            background: linear-gradient(135deg, #e8a838, #c88a28);
            color: #0e1117;
            border: none;
            border-radius: 8px;
            font-weight: 700;
            font-size: 13px;
            cursor: pointer;
            transition: transform 0.2s;
            text-transform: uppercase;
            letter-spacing: 0.5px;
        }
        .btn:hover {
            transform: translateY(-2px);
        }
        .result {
            margin-top: 30px;
            padding: 20px;
            background: rgba(232,168,56,0.1);
            border: 1px solid rgba(232,168,56,0.3);
            border-radius: 8px;
            display: none;
        }
        .result.show {
            display: block;
        }
        .result-label {
            font-size: 11px;
            color: #8896b0;
            text-transform: uppercase;
            margin-bottom: 8px;
            letter-spacing: 1px;
        }
        .result-hash {
            background: #0e1117;
            padding: 12px;
            border-radius: 6px;
            border: 1px solid rgba(232,168,56,0.2);
            font-family: monospace;
            font-size: 11px;
            color: #e8a838;
            word-break: break-all;
            line-height: 1.6;
            margin-bottom: 12px;
        }
        .copy-btn {
            width: 100%;
            padding: 8px;
            background: rgba(42,181,160,0.2);
            color: #2ab5a0;
            border: 1px solid rgba(42,181,160,0.3);
            border-radius: 6px;
            cursor: pointer;
            font-weight: 500;
            font-size: 12px;
            transition: background 0.2s;
        }
        .copy-btn:hover {
            background: rgba(42,181,160,0.3);
        }
        .error {
            padding: 12px;
            background: rgba(224,82,82,0.1);
            border: 1px solid rgba(224,82,82,0.3);
            border-radius: 6px;
            color: #e05252;
            margin-top: 20px;
            font-size: 13px;
        }
        .info {
            margin-top: 30px;
            padding: 16px;
            background: rgba(77,142,240,0.1);
            border-left: 3px solid #4d8ef0;
            border-radius: 4px;
            font-size: 12px;
            line-height: 1.6;
            color: #7da2e8;
        }
        .info strong {
            color: #4d8ef0;
        }
        code {
            background: #0e1117;
            padding: 2px 6px;
            border-radius: 3px;
            font-family: monospace;
            font-size: 11px;
            color: #e8a838;
        }
    </style>
</head>
<body>
    <div class="container">
        <h1>🔐 Password Hash Generator</h1>
        <p class="desc">Generate bcrypt password hashes for FYP Nexus database users. Paste the generated hash into the <code>password_hash</code> field when inserting users.</p>

        <form method="POST">
            <div class="form-group">
                <label for="pass">Enter Password (min 8 chars)</label>
                <input type="password" id="pass" name="pass" placeholder="e.g., MySecurePass123" required>
            </div>
            <button type="submit" class="btn">Generate Hash</button>
        </form>

        <?php if (!empty($hash)): ?>
        <div class="result show">
            <div class="result-label">Generated bcrypt Hash (Cost 12)</div>
            <div class="result-hash" id="hashOutput"><?php echo htmlspecialchars($hash); ?></div>
            <button class="copy-btn" onclick="copyHash()">📋 Copy to Clipboard</button>
        </div>
        <?php endif; ?>

        <?php if (!empty($error)): ?>
        <div class="error">⚠️ <?php echo htmlspecialchars($error); ?></div>
        <?php endif; ?>

        <div class="info">
            <strong>How to use this hash:</strong><br><br>
            1. Copy the generated hash above<br>
            2. Go to phpMyAdmin → fyp_nexus database<br>
            3. Click "users" table → "Insert"<br>
            4. Fill in:<br>
            &nbsp;&nbsp;&nbsp;&nbsp;• full_name: Your Name<br>
            &nbsp;&nbsp;&nbsp;&nbsp;• email: user@university.edu<br>
            &nbsp;&nbsp;&nbsp;&nbsp;• password_hash: [PASTE THE HASH]<br>
            &nbsp;&nbsp;&nbsp;&nbsp;• role: student (or supervisor)<br>
            5. Click Insert<br><br>
            Then login with the email and password you used above.
        </div>
    </div>

    <script>
    function copyHash() {
        const hash = document.getElementById('hashOutput').textContent;
        navigator.clipboard.writeText(hash).then(() => {
            alert('Hash copied to clipboard!');
        }).catch(err => {
            alert('Failed to copy: ' + err);
        });
    }
    </script>
</body>
</html>
