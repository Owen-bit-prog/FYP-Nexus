<?php
// ============================================================
// projects.php — Project CRUD, Milestones, Progress
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

    // ── MY PROJECT(S) ─────────────────────────────────────
    case 'get_my_projects':
        if ($user['role'] === 'student') {
            $projects = DB::fetchAll(
                'SELECT p.*, u.full_name AS supervisor_name, u.email AS supervisor_email,
                        u.department AS supervisor_dept
                 FROM projects p
                 LEFT JOIN users u ON u.id = p.supervisor_id
                 WHERE p.student_id = ?
                 ORDER BY p.created_at DESC',
                [$user['id']]
            );
        } elseif ($user['role'] === 'supervisor') {
            $projects = DB::fetchAll(
                'SELECT p.*, u.full_name AS student_name, u.email AS student_email,
                        u.student_id AS student_number, u.department AS student_dept,
                        u.is_online AS student_online
                 FROM projects p
                 JOIN users u ON u.id = p.student_id
                 WHERE p.supervisor_id = ?
                 ORDER BY p.updated_at DESC',
                [$user['id']]
            );
        } else {
            // Admin: all projects
            $projects = DB::fetchAll(
                'SELECT p.*,
                        s.full_name AS student_name,
                        sv.full_name AS supervisor_name
                 FROM projects p
                 JOIN users s  ON s.id  = p.student_id
                 LEFT JOIN users sv ON sv.id = p.supervisor_id
                 ORDER BY p.updated_at DESC'
            );
        }
        jsonResponse(['success' => true, 'projects' => $projects]);
        break;

    // ── GROUP DASHBOARD FOR STUDENTS ──────────────────────
    case 'get_group_dashboard':
        $user = requireAuth('student');
        $project = DB::fetch(
            'SELECT p.*, u.full_name AS supervisor_name, u.email AS supervisor_email,
                    u.department AS supervisor_dept, u.id AS supervisor_id
             FROM projects p
             LEFT JOIN users u ON u.id = p.supervisor_id
             WHERE p.student_id = ?
             ORDER BY p.created_at DESC LIMIT 1',
            [$user['id']]
        );

        if (!$project) {
            jsonResponse(['success' => true, 'group' => null]);
        }

        $groupCode = 'GRP-' . str_pad((string)$project['id'], 4, '0', STR_PAD_LEFT);
        $members = [[
            'name' => $user['full_name'],
            'index_number' => $user['student_id'] ?? '—',
            'is_group_leader' => true,
        ]];

        $hasGroupMembersTable = (bool)DB::fetch(
            "SELECT COUNT(*) AS c FROM information_schema.tables WHERE table_schema = ? AND table_name = 'group_members'",
            [DB_NAME]
        )['c'];

        if ($hasGroupMembersTable) {
            $members = DB::fetchAll(
                'SELECT u.full_name AS name, u.student_id AS index_number, gm.is_group_leader
                 FROM group_members gm
                 JOIN users u ON u.id = gm.user_id
                 WHERE gm.group_id = ?
                 ORDER BY gm.is_group_leader DESC, u.full_name ASC',
                [$project['id']]
            );
        }

        $files = DB::fetchAll(
            'SELECT * FROM files WHERE project_id = ? ORDER BY created_at DESC',
            [$project['id']]
        );
        $meetings = DB::fetchAll(
            'SELECT * FROM meetings WHERE project_id = ? ORDER BY scheduled_at ASC',
            [$project['id']]
        );
        $notifications = DB::fetchAll(
            'SELECT * FROM notifications WHERE user_id = ? ORDER BY created_at DESC LIMIT 8',
            [$user['id']]
        );

        $proposalSubmission = null;
        $chapterSubmissions = 0;
        $finalReport = null;
        foreach ($files as $file) {
            $type = $file['submission_type'] ?? 'other';
            if ($type === 'chapter') $chapterSubmissions++;
            if (($file['title'] ?? '') !== '' && stripos($file['title'], 'proposal') !== false) {
                $proposalSubmission = $file['title'];
            }
            if (($file['title'] ?? '') !== '' && stripos($file['title'], 'final') !== false) {
                $finalReport = $file['title'];
            }
        }
        if (!$proposalSubmission && $files) {
            $proposalSubmission = $files[0]['title'] ?: $files[0]['original_name'];
        }
        if (!$finalReport && $proposalSubmission && count($files) > 1) {
            $finalReport = $files[1]['title'] ?: $files[1]['original_name'];
        }

        $feedback = array_values(array_filter($files, function ($file) {
            return !empty($file['feedback']) && $file['review_status'] !== 'pending';
        }));

        $groupData = [
            'group_code' => $groupCode,
            'group_name' => $project['title'] ? $project['title'] . ' Group' : 'Project Group',
            'project_title' => $project['title'] ?? 'Untitled Project',
            'project_description' => $project['description'] ?? 'Shared workspace for the assigned group project.',
            'assigned_supervisor' => $project['supervisor_name'] ?? 'Pending assignment',
            'group_status' => ucfirst($project['status'] ?? 'pending'),
            'date_created' => $project['created_at'] ? date('d M Y', strtotime($project['created_at'])) : '—',
            'group_leader' => true,
            'members' => $members,
            'workspace' => [
                'project_title' => $project['title'] ?? 'Untitled Project',
                'project_description' => $project['description'] ?? 'Shared project workspace',
                'proposal_submission' => $proposalSubmission ?: 'Not submitted',
                'chapter_submissions' => $chapterSubmissions,
                'final_report' => $finalReport ?: 'Not submitted',
                'project_progress' => (int)($project['progress'] ?? 0),
                'project_status' => ucfirst($project['status'] ?? 'pending'),
            ],
            'supervisor' => [
                'name' => $project['supervisor_name'] ?? 'Pending Assignment',
                'staff_id' => $project['supervisor_id'] ?? '—',
                'department' => $project['supervisor_dept'] ?? '—',
                'email' => $project['supervisor_email'] ?? '—',
            ],
            'feedback' => array_map(function ($item) {
                return [
                    'title' => $item['title'] ?: $item['original_name'] ?: 'Feedback',
                    'feedback' => $item['feedback'] ?: 'No written feedback available.',
                    'reviewed_at' => $item['reviewed_at'] ? date('d M Y', strtotime($item['reviewed_at'])) : 'Pending',
                ];
            }, $feedback),
            'meetings' => array_map(function ($meeting) {
                return [
                    'title' => $meeting['title'] ?: 'Meeting',
                    'scheduled_at' => $meeting['scheduled_at'] ? date('d M Y, H:i', strtotime($meeting['scheduled_at'])) : '—',
                    'meeting_type' => ucfirst(str_replace('_', ' ', $meeting['meeting_type'] ?? 'video')),
                    'notes' => $meeting['notes'] ?: 'No notes provided.',
                ];
            }, $meetings),
            'notifications' => array_map(function ($notification) {
                return [
                    'title' => $notification['title'] ?: 'Update',
                    'body' => $notification['body'] ?: 'New update available.',
                ];
            }, $notifications),
        ];

        jsonResponse(['success' => true, 'group' => $groupData]);
        break;

    // ── SINGLE PROJECT DETAIL ─────────────────────────────
    case 'get_project':
        $id = (int)($_GET['id'] ?? $_POST['id'] ?? 0);
        $project = DB::fetch(
            'SELECT p.*,
                    s.full_name  AS student_name,  s.email AS student_email,  s.student_id AS student_number,
                    s.department AS student_dept,  s.is_online AS student_online, s.avatar_path AS student_avatar,
                    sv.full_name AS supervisor_name, sv.email AS supervisor_email,
                    sv.department AS supervisor_dept, sv.is_online AS supervisor_online, sv.avatar_path AS supervisor_avatar
             FROM projects p
             JOIN users s   ON s.id  = p.student_id
             LEFT JOIN users sv ON sv.id = p.supervisor_id
             WHERE p.id = ?',
            [$id]
        );
        if (!$project) jsonResponse(['success' => false, 'message' => 'Project not found.'], 404);
        jsonResponse(['success' => true, 'project' => $project]);
        break;

    // ── CREATE PROJECT ────────────────────────────────────
    case 'create':
        $user = requireAuth('student');
        $title       = sanitize($_POST['title']       ?? '');
        $description = sanitize($_POST['description'] ?? '');
        $category    = sanitize($_POST['category']    ?? '');
        $tags        = sanitize($_POST['tags']        ?? '');
        $deadline    = $_POST['deadline'] ?? null;
        $supEmail    = trim($_POST['supervisor_email'] ?? '');

        if (!$title) jsonResponse(['success' => false, 'message' => 'Project title is required.']);

        // Find supervisor
        $supervisor = null;
        if ($supEmail) {
            $supervisor = DB::fetch('SELECT id FROM users WHERE email = ? AND role = "supervisor"', [$supEmail]);
        }

        $id = DB::insert(
            'INSERT INTO projects (title, description, student_id, supervisor_id, category, tags, deadline, start_date)
             VALUES (?,?,?,?,?,?,?,CURDATE())',
            [$title, $description, $user['id'], $supervisor ? $supervisor['id'] : null, $category, $tags, $deadline ?: null]
        );

        logActivity($user['id'], (int)$id, 'project_created', "Created project: $title");

        if ($supervisor) {
            addNotification($supervisor['id'], 'project', 'New Project Assigned',
                "$user[full_name] created a project and assigned you as supervisor.", (int)$id, 'project');
        }

        $project = DB::fetch('SELECT * FROM projects WHERE id = ?', [(int)$id]);
        jsonResponse(['success' => true, 'project' => $project]);
        break;

    // ── UPDATE PROJECT ────────────────────────────────────
    case 'update':
        $id      = (int)($_POST['id'] ?? 0);
        $project = DB::fetch('SELECT * FROM projects WHERE id = ?', [$id]);
        if (!$project) jsonResponse(['success' => false, 'message' => 'Project not found.'], 404);

        // Only student owner or supervisor can update
        if ($user['role'] === 'student' && $project['student_id'] !== $user['id'])
            jsonResponse(['success' => false, 'message' => 'Forbidden'], 403);
        if ($user['role'] === 'supervisor' && $project['supervisor_id'] !== $user['id'])
            jsonResponse(['success' => false, 'message' => 'Forbidden'], 403);

        $fields = [];
        $values = [];
        $allowed = ['title','description','category','tags','deadline','status','progress'];
        foreach ($allowed as $f) {
            if (isset($_POST[$f])) {
                $fields[] = "$f = ?";
                $values[] = $f === 'progress' ? (int)$_POST[$f] : sanitize($_POST[$f]);
            }
        }
        if (!$fields) jsonResponse(['success' => false, 'message' => 'Nothing to update.']);
        $values[] = $id;
        DB::query('UPDATE projects SET ' . implode(', ', $fields) . ', updated_at=NOW() WHERE id=?', $values);

        logActivity($user['id'], $id, 'project_updated', 'Updated project fields: ' . implode(', ', array_keys($_POST)));

        $updated = DB::fetch('SELECT * FROM projects WHERE id = ?', [$id]);
        jsonResponse(['success' => true, 'project' => $updated]);
        break;

    // ── GET MILESTONES ────────────────────────────────────
    case 'get_milestones':
        $projectId = (int)($_GET['project_id'] ?? $_POST['project_id'] ?? 0);
        $milestones = DB::fetchAll(
            'SELECT * FROM milestones WHERE project_id = ? ORDER BY order_num ASC, due_date ASC',
            [$projectId]
        );
        jsonResponse(['success' => true, 'milestones' => $milestones]);
        break;

    // ── ADD MILESTONE ─────────────────────────────────────
    case 'add_milestone':
        $projectId  = (int)($_POST['project_id'] ?? 0);
        $title      = sanitize($_POST['title']      ?? '');
        $description= sanitize($_POST['description']?? '');
        $dueDate    = $_POST['due_date'] ?? null;

        if (!$title) jsonResponse(['success' => false, 'message' => 'Milestone title is required.']);

        $maxOrder = DB::fetch('SELECT MAX(order_num) AS m FROM milestones WHERE project_id = ?', [$projectId]);
        $order = ($maxOrder['m'] ?? 0) + 1;

        $id = DB::insert(
            'INSERT INTO milestones (project_id, title, description, due_date, order_num) VALUES (?,?,?,?,?)',
            [$projectId, $title, $description, $dueDate ?: null, $order]
        );

        logActivity($user['id'], $projectId, 'milestone_added', "Added milestone: $title");

        $milestone = DB::fetch('SELECT * FROM milestones WHERE id = ?', [(int)$id]);
        jsonResponse(['success' => true, 'milestone' => $milestone]);
        break;

    // ── UPDATE MILESTONE STATUS ───────────────────────────
    case 'update_milestone':
        $id     = (int)($_POST['id'] ?? 0);
        $status = sanitize($_POST['status'] ?? '');
        if (!in_array($status, ['pending','in_progress','completed','overdue'], true))
            jsonResponse(['success' => false, 'message' => 'Invalid status.']);

        DB::query('UPDATE milestones SET status = ? WHERE id = ?', [$status, $id]);
        $ms = DB::fetch('SELECT * FROM milestones WHERE id = ?', [$id]);

        // Auto-update project progress
        $total     = DB::fetch('SELECT COUNT(*) AS c FROM milestones WHERE project_id = ?', [$ms['project_id']]);
        $completed = DB::fetch('SELECT COUNT(*) AS c FROM milestones WHERE project_id = ? AND status = "completed"', [$ms['project_id']]);
        if ($total['c'] > 0) {
            $pct = (int)round(($completed['c'] / $total['c']) * 100);
            DB::query('UPDATE projects SET progress = ?, updated_at=NOW() WHERE id = ?', [$pct, $ms['project_id']]);
        }

        logActivity($user['id'], $ms['project_id'], 'milestone_updated', "Milestone '$ms[title]' → $status");
        jsonResponse(['success' => true, 'milestone' => $ms]);
        break;

    // ── ACTIVITY FEED ─────────────────────────────────────
    case 'get_activity':
        $projectId = (int)($_GET['project_id'] ?? 0);
        $limit     = (int)($_GET['limit'] ?? 20);
        $where = $projectId ? 'WHERE a.project_id = ?' : 'WHERE a.user_id = ?';
        $param = $projectId ?: $user['id'];
        $logs = DB::fetchAll(
            "SELECT a.*, u.full_name, u.role FROM activity_log a
             JOIN users u ON u.id = a.user_id
             $where ORDER BY a.created_at DESC LIMIT $limit",
            [$param]
        );
        jsonResponse(['success' => true, 'activity' => $logs]);
        break;

    // ── GET PROPOSALS (Supervisor) ────────────────────────
    case 'get_proposals':
        $user = requireAuth('supervisor');
        // Proposals are projects with status 'pending' assigned to this supervisor,
        // OR unassigned pending projects that supervisor can view
        $proposals = DB::fetchAll(
            'SELECT p.*, u.full_name AS student_name, u.email AS student_email,
                    u.student_id AS student_number, u.department AS student_dept, u.avatar_path AS student_avatar
             FROM projects p
             JOIN users u ON u.id = p.student_id
             WHERE p.status = "pending"
               AND (p.supervisor_id = ? OR p.supervisor_id IS NULL)
             ORDER BY p.created_at DESC',
            [$user['id']]
        );
        jsonResponse(['success' => true, 'proposals' => $proposals]);
        break;

    // ── RESPOND TO PROPOSAL (Supervisor: approve/reject/revision) ─
    case 'respond_proposal':
        $user     = requireAuth('supervisor');
        $projectId= (int)($_POST['project_id'] ?? 0);
        $decision = sanitize($_POST['decision'] ?? '');   // approve | reject | revision
        $feedback = sanitize($_POST['feedback'] ?? '');

        if (!in_array($decision, ['approve','reject','revision'], true))
            jsonResponse(['success' => false, 'message' => 'Invalid decision.']);

        $project = DB::fetch('SELECT * FROM projects WHERE id = ?', [$projectId]);
        if (!$project) jsonResponse(['success' => false, 'message' => 'Project not found.'], 404);

        // Only assigned supervisor or unassigned projects
        if ($project['supervisor_id'] && $project['supervisor_id'] !== $user['id'])
            jsonResponse(['success' => false, 'message' => 'Forbidden'], 403);

        $newStatus = match($decision) {
            'approve'  => 'active',
            'reject'   => 'rejected',
            'revision' => 'revision',
            default    => 'pending'
        };

        DB::query(
            'UPDATE projects SET status = ?, supervisor_id = ?, updated_at = NOW() WHERE id = ?',
            [$newStatus, $user['id'], $projectId]
        );

        // Notify student
        $labels = ['approve' => 'Approved ✅', 'reject' => 'Rejected ❌', 'revision' => 'Revision Required ⚠️'];
        addNotification(
            $project['student_id'], 'proposal',
            'Proposal ' . $labels[$decision],
            "Your proposal \"{$project['title']}\" has been {$labels[$decision]}." . ($feedback ? " Feedback: $feedback" : ''),
            $projectId, 'project'
        );

        logActivity($user['id'], $projectId, 'proposal_' . $decision, "Proposal \"{$project['title']}\" → $decision");

        jsonResponse(['success' => true, 'message' => 'Response recorded.', 'new_status' => $newStatus]);
        break;

    // ── SUBMIT PROPOSAL (Student) ─────────────────────────
    case 'submit_proposal':
        $user        = requireAuth('student');
        $title       = sanitize($_POST['title']       ?? '');
        $description = sanitize($_POST['description'] ?? '');
        $category    = sanitize($_POST['category']    ?? '');
        $tags        = sanitize($_POST['tags']        ?? '');
        $deadline    = $_POST['deadline'] ?? null;
        $supEmail    = trim($_POST['supervisor_email'] ?? '');

        if (!$title)       jsonResponse(['success' => false, 'message' => 'Title is required.']);
        if (!$description) jsonResponse(['success' => false, 'message' => 'Description is required.']);

        // Check student doesn't already have a pending or active project
        $existing = DB::fetch(
            'SELECT id FROM projects WHERE student_id = ? AND status IN ("pending","active","revision") LIMIT 1',
            [$user['id']]
        );
        if ($existing) jsonResponse(['success' => false, 'message' => 'You already have an active proposal or project.']);

        $supervisor = null;
        if ($supEmail) {
            $supervisor = DB::fetch('SELECT id FROM users WHERE email = ? AND role = "supervisor"', [$supEmail]);
        }

        $id = DB::insert(
            'INSERT INTO projects (title, description, student_id, supervisor_id, category, tags, deadline, status, start_date)
             VALUES (?,?,?,?,?,?,?,"pending",CURDATE())',
            [$title, $description, $user['id'], $supervisor ? $supervisor['id'] : null,
             $category, $tags, $deadline ?: null]
        );

        if ($supervisor) {
            addNotification($supervisor['id'], 'proposal', 'New Proposal Awaiting Review',
                "{$user['full_name']} submitted a proposal: \"$title\".", (int)$id, 'project');
        }

        logActivity($user['id'], (int)$id, 'proposal_submitted', "Submitted proposal: $title");

        $project = DB::fetch('SELECT * FROM projects WHERE id = ?', [(int)$id]);
        jsonResponse(['success' => true, 'project' => $project]);
        break;

    default:
        jsonResponse(['success' => false, 'message' => 'Unknown action.'], 400);
}
