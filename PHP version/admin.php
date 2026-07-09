<?php
session_start();

$adminCode = '6767';

$autoBackupSecret = '9inchnails';

if (isset($_GET['auto_backup']) && ($_GET['key'] ?? '') === $autoBackupSecret) {
    $_POST['create_backup'] = 1;
    $_SESSION['graphics_admin'] = true;
}

if (isset($_POST['access_code'])) {
    if ($_POST['access_code'] === $adminCode) {
        $_SESSION['graphics_admin'] = true;
        header("Location: admin.php");
        exit;
    } else {
        $loginError = "Invalid Access Code";
    }
}

if (isset($_GET['logout'])) {
    session_destroy();
    header("Location: admin.php");
    exit;
}

if (!isset($_SESSION['graphics_admin'])):

?>

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/gm2-base.css?v=<?php echo filemtime('assets/css/gm2-base.css'); ?>">
<link rel="stylesheet" href="assets/css/gm2-admin.css?v=<?php echo filemtime('assets/css/gm2-admin.css'); ?>">
<title>Admin Access</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">

</head>

<body class="login-page">
<div class="wrapper">
<div class="login-card">
    <img src="SUMTER HC-LOGO-HORIZONTAL-web.png" alt="Logo" class="admin-login-logo">

    <h1>Admin Access</h1>
    <p>Enter Access Code</p>

    <form method="POST">
        <input 
            type="password" 
            name="access_code" 
            maxlength="4"
            required
            autofocus
        >

        <button type="submit">Access Admin</button>
    </form>

    <?php if (isset($loginError)): ?>
        <div class="error"><?php echo htmlspecialchars($loginError); ?></div>
    <?php endif; ?>

    <a class="public-link" href="index.php">Back to View Only</a>
</div>
</div>

</body>
</html>

<?php
exit;
endif;

ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

$db = new SQLite3('graphics.db');

$db->exec("
CREATE TABLE IF NOT EXISTS vendor_art (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    vendor_name TEXT NOT NULL,
    vendor_prefix TEXT NOT NULL,
    vendor_raw_number TEXT,
    vendor_art_number TEXT UNIQUE,
    customer_number TEXT,
    customer_name TEXT,
    part_number TEXT,
    preview_image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
    last_updated DATETIME DEFAULT CURRENT_TIMESTAMP
)
");

$vendorColsExisting = [];
$vendorCols = $db->query("PRAGMA table_info(vendor_art)");
while ($vendorCol = $vendorCols->fetchArray(SQLITE3_ASSOC)) {
    $vendorColsExisting[] = $vendorCol['name'];
}
if (!in_array('last_updated', $vendorColsExisting, true)) {
    $db->exec("ALTER TABLE vendor_art ADD COLUMN last_updated DATETIME DEFAULT CURRENT_TIMESTAMP");
}

$vendorArtMessage = '';
$vendorArtMessageType = '';


$backupDir = __DIR__ . '/backup_temp';
$backupMessage = '';
$backupMessageType = '';
$backupFileName = '';

function addPathToBackupZip($zip, $fullPath, $basePath, $skipNames = []) {
    $name = basename($fullPath);

    if (in_array($name, $skipNames, true)) {
        return;
    }

    if (is_file($fullPath)) {
        $relativePath = substr($fullPath, strlen($basePath) + 1);
        $zip->addFile($fullPath, $relativePath);
        return;
    }

    if (is_dir($fullPath)) {
        $iterator = new RecursiveIteratorIterator(
            new RecursiveDirectoryIterator($fullPath, RecursiveDirectoryIterator::SKIP_DOTS),
            RecursiveIteratorIterator::SELF_FIRST
        );

        foreach ($iterator as $file) {
            $filePath = $file->getPathname();
            $fileName = basename($filePath);

            if (in_array($fileName, $skipNames, true)) {
                continue;
            }

            $relativePath = substr($filePath, strlen($basePath) + 1);

            if ($file->isDir()) {
                $zip->addEmptyDir($relativePath);
            } else {
                $zip->addFile($filePath, $relativePath);
            }
        }
    }
}

if (isset($_GET['auto_backup'])) {
    $_POST['create_backup'] = 1;
}

function createGraphicsManagementBackup($backupDir) {
    if (!class_exists('ZipArchive')) {
        throw new Exception('PHP ZipArchive is not enabled. Enable the zip extension in XAMPP/PHP to create backups.');
    }

    if (!is_dir($backupDir)) {
        if (!mkdir($backupDir, 0777, true)) {
            throw new Exception('Backup folder could not be created: ' . $backupDir);
        }
    }

    if (!is_writable($backupDir)) {
        throw new Exception('Backup folder is not writable: ' . $backupDir);
    }

    $backupFileName = 'graphics_management_backup_' . date('Y-m-d_H-i-s') . '.zip';
    $backupPath = rtrim($backupDir, '/') . '/' . $backupFileName;

    if (file_exists($backupPath)) {
        @unlink($backupPath);
    }

    $zip = new ZipArchive();
    $openResult = $zip->open($backupPath, ZipArchive::CREATE | ZipArchive::OVERWRITE);

    if ($openResult !== true) {
        throw new Exception('Could not create backup ZIP. ZipArchive error code: ' . $openResult);
    }

    $basePath = __DIR__;
    $skipNames = [
        '.',
        '..',
        '.DS_Store',
        'magick_tmp',
        'backups',
        'backup_temp'
    ];

    $items = scandir($basePath);

    foreach ($items as $item) {
        if (in_array($item, $skipNames, true)) {
            continue;
        }

        addPathToBackupZip($zip, $basePath . '/' . $item, $basePath, $skipNames);
    }

    if (!$zip->close()) {
        throw new Exception('ZipArchive could not finalize the backup ZIP.');
    }

    if (!file_exists($backupPath) || filesize($backupPath) <= 0) {
        throw new Exception('Backup ZIP was not created correctly: ' . $backupPath);
    }

    return [
        'file_name' => $backupFileName,
        'full_path' => $backupPath
    ];
}

if (isset($_GET['download_backup'])) {
    $requestedBackup = basename($_GET['download_backup']);
    $downloadPath = rtrim($backupDir, '/') . '/' . $requestedBackup;

    if ($requestedBackup === '' || !file_exists($downloadPath) || strtolower(pathinfo($downloadPath, PATHINFO_EXTENSION)) !== 'zip') {
        http_response_code(404);
        exit('Backup file not found.');
    }

    header('Content-Type: application/zip');
    header('Content-Disposition: attachment; filename="' . $requestedBackup . '"');
    header('Content-Length: ' . filesize($downloadPath));
    readfile($downloadPath);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && isset($_POST['create_backup'])) {
    try {
        $backup = createGraphicsManagementBackup($backupDir);
        $_SESSION['backup_message'] = 'Backup created successfully: ' . $backup['full_path'];
        $_SESSION['backup_message_type'] = 'success';
        $_SESSION['backup_file_name'] = $backup['file_name'];
    } catch (Exception $e) {
        $_SESSION['backup_message'] = $e->getMessage();
        $_SESSION['backup_message_type'] = 'warning';
        $_SESSION['backup_file_name'] = '';
    }

    header('Location: admin.php?tab=tools&backup=1');
    exit;
}

if (isset($_SESSION['backup_message'])) {
    $backupMessage = $_SESSION['backup_message'];
    $backupMessageType = $_SESSION['backup_message_type'] ?? 'success';
    $backupFileName = $_SESSION['backup_file_name'] ?? '';

    unset($_SESSION['backup_message'], $_SESSION['backup_message_type'], $_SESSION['backup_file_name']);
}


if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'repair_approval_links') {
    $repairSummary = repairApprovalLinksForSystemTools($db);
    $_SESSION['maintenance_message_type'] = empty($repairSummary['errors']) ? 'success' : 'warning';
    $_SESSION['maintenance_message'] = 'Approval link repair complete: ' .
        intval($repairSummary['graphics_preview_repaired']) . ' Graphics preview link(s) repaired, ' .
        intval($repairSummary['revision_pdf_repaired']) . ' approval revision PDF link(s) repaired.' .
        (!empty($repairSummary['errors']) ? ' ' . implode(' ', $repairSummary['errors']) : '');
    header('Location: admin.php?tab=tools&maintenance=1');
    exit;
}

$maintenanceMessage = $_SESSION['maintenance_message'] ?? '';
$maintenanceMessageType = $_SESSION['maintenance_message_type'] ?? 'success';
unset($_SESSION['maintenance_message'], $_SESSION['maintenance_message_type']);

function getBackupDashboardStats($backupDir) {
    $stats = ['count' => 0, 'total_size' => 0, 'latest_name' => '', 'latest_time' => 0, 'latest_size' => 0];
    if (!is_dir($backupDir)) { return $stats; }
    $files = glob(rtrim($backupDir, '/') . '/*.zip') ?: [];
    foreach ($files as $file) {
        if (!is_file($file)) { continue; }
        $size = filesize($file) ?: 0;
        $mtime = filemtime($file) ?: 0;
        $stats['count']++;
        $stats['total_size'] += $size;
        if ($mtime > $stats['latest_time']) {
            $stats['latest_time'] = $mtime;
            $stats['latest_name'] = basename($file);
            $stats['latest_size'] = $size;
        }
    }
    return $stats;
}

function formatBytesForAdmin($bytes) {
    $bytes = floatval($bytes);
    $units = ['B', 'KB', 'MB', 'GB', 'TB'];
    $index = 0;
    while ($bytes >= 1024 && $index < count($units) - 1) { $bytes /= 1024; $index++; }
    return ($index === 0 ? intval($bytes) : number_format($bytes, 1)) . ' ' . $units[$index];
}

$backupStats = getBackupDashboardStats($backupDir);

function adminTableExists($db, $tableName) {
    $stmt = $db->prepare("SELECT name FROM sqlite_master WHERE type='table' AND name=:name LIMIT 1");
    $stmt->bindValue(':name', $tableName);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    return !empty($row);
}

function adminCountRows($db, $tableName) {
    if (!adminTableExists($db, $tableName)) {
        return 0;
    }

    return intval($db->querySingle("SELECT COUNT(*) FROM " . $tableName));
}

function adminCountApprovalPdfs($db) {
    if (!adminTableExists($db, 'graphics')) {
        return 0;
    }

    return intval($db->querySingle("
        SELECT COUNT(*)
        FROM graphics
        WHERE preview_image IS NOT NULL
          AND preview_image != ''
          AND preview_image LIKE 'approvals/%'
    "));
}

$managementStats = [
    'graphics' => adminCountRows($db, 'graphics'),
    'print_cards' => adminCountRows($db, 'print_card_revisions'),
    'approvals' => adminCountApprovalPdfs($db),
    'approval_revisions' => adminCountRows($db, 'approval_revisions'),
    'vendor_art' => adminCountRows($db, 'vendor_art')
];


function getCleanGNumberForMaintenance($value) {
    return preg_replace('/[^0-9]/', '', (string)($value ?? ''));
}

function getDatabaseHealthReport($db) {
    $report = [
        'graphics' => adminCountRows($db, 'graphics'),
        'approvals' => adminCountApprovalPdfs($db),
        'approval_revisions' => adminCountRows($db, 'approval_revisions'),
        'print_cards' => adminCountRows($db, 'print_card_revisions'),
        'vendor_art' => adminCountRows($db, 'vendor_art'),
        'missing_graphic_preview_files' => [],
        'missing_revision_pdf_files' => [],
        'orphan_approval_files' => [],
        'orphan_revision_rows' => [],
        'repairable_approval_links' => []
    ];

    if (adminTableExists($db, 'graphics')) {
        $graphics = $db->query("SELECT g_number, preview_image FROM graphics ORDER BY CAST(REPLACE(REPLACE(g_number, 'G#', ''), '#', '') AS INTEGER) DESC");
        while ($row = $graphics->fetchArray(SQLITE3_ASSOC)) {
            $cleanG = getCleanGNumberForMaintenance($row['g_number'] ?? '');
            $preview = safePath($row['preview_image'] ?? '');

            if ($preview && strpos($preview, 'approvals/') === 0 && !file_exists(__DIR__ . '/' . $preview)) {
                $report['missing_graphic_preview_files'][] = [
                    'g_number' => $row['g_number'] ?? '',
                    'path' => $preview
                ];
            }

            $expectedApproval = $cleanG ? 'approvals/' . $cleanG . '_APPROVAL.pdf' : '';
            if ($expectedApproval && file_exists(__DIR__ . '/' . $expectedApproval) && $preview !== $expectedApproval) {
                $report['repairable_approval_links'][] = [
                    'g_number' => $row['g_number'] ?? '',
                    'path' => $expectedApproval
                ];
            }
        }
    }

    if (adminTableExists($db, 'approval_revisions')) {
        $revisions = $db->query("SELECT id, g_number, approval_pdf FROM approval_revisions ORDER BY id DESC");
        while ($row = $revisions->fetchArray(SQLITE3_ASSOC)) {
            $cleanG = getCleanGNumberForMaintenance($row['g_number'] ?? '');
            $pdf = safePath($row['approval_pdf'] ?? '');

            if ($cleanG !== '') {
                $graphicExistsStmt = $db->prepare("SELECT COUNT(*) AS total_rows FROM graphics WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number");
                $graphicExistsStmt->bindValue(':g_number', $cleanG);
                $graphicExists = intval(($graphicExistsStmt->execute()->fetchArray(SQLITE3_ASSOC)['total_rows'] ?? 0));
                if ($graphicExists <= 0) {
                    $report['orphan_revision_rows'][] = [
                        'id' => intval($row['id'] ?? 0),
                        'g_number' => $row['g_number'] ?? ''
                    ];
                }
            }

            if ($pdf && strpos($pdf, 'approvals/') === 0 && !file_exists(__DIR__ . '/' . $pdf)) {
                $report['missing_revision_pdf_files'][] = [
                    'id' => intval($row['id'] ?? 0),
                    'g_number' => $row['g_number'] ?? '',
                    'path' => $pdf
                ];
            }
        }
    }

    $approvalFiles = glob(__DIR__ . '/approvals/*.pdf') ?: [];
    foreach ($approvalFiles as $filePath) {
        $fileName = basename($filePath);
        if (!preg_match('/^(?:G#?)?(\d+).*\.pdf$/i', $fileName, $matches)) {
            continue;
        }

        $cleanG = $matches[1];
        $graphicExistsStmt = $db->prepare("SELECT COUNT(*) AS total_rows FROM graphics WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number");
        $graphicExistsStmt->bindValue(':g_number', $cleanG);
        $graphicExists = intval(($graphicExistsStmt->execute()->fetchArray(SQLITE3_ASSOC)['total_rows'] ?? 0));

        if ($graphicExists <= 0) {
            $report['orphan_approval_files'][] = 'approvals/' . $fileName;
        }
    }

    return $report;
}

function repairApprovalLinksForSystemTools($db) {
    $summary = [
        'graphics_preview_repaired' => 0,
        'revision_pdf_repaired' => 0,
        'errors' => []
    ];

    if (!adminTableExists($db, 'graphics')) {
        $summary['errors'][] = 'Graphics table was not found.';
        return $summary;
    }

    if (!adminTableExists($db, 'approval_revisions')) {
        $summary['errors'][] = 'Approval revisions table was not found.';
        return $summary;
    }

    $graphics = $db->query("SELECT id, g_number, preview_image FROM graphics");

    $updateGraphic = $db->prepare("UPDATE graphics SET preview_image = :preview_image WHERE id = :id");
    $findLatestRevision = $db->prepare("\n        SELECT id\n        FROM approval_revisions\n        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number\n        ORDER BY\n            CASE WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER) ELSE -1 END DESC,\n            id DESC\n        LIMIT 1\n    ");
    $updateRevision = $db->prepare("UPDATE approval_revisions SET approval_pdf = :approval_pdf WHERE id = :id");

    $db->exec('BEGIN TRANSACTION');

    try {
        while ($row = $graphics->fetchArray(SQLITE3_ASSOC)) {
            $cleanG = getCleanGNumberForMaintenance($row['g_number'] ?? '');
            if ($cleanG === '') {
                continue;
            }

            $expectedApproval = 'approvals/' . $cleanG . '_APPROVAL.pdf';
            if (!file_exists(__DIR__ . '/' . $expectedApproval)) {
                continue;
            }

            $currentPreview = safePath($row['preview_image'] ?? '');
            if ($currentPreview !== $expectedApproval) {
                $updateGraphic->reset();
                $updateGraphic->clear();
                $updateGraphic->bindValue(':preview_image', $expectedApproval);
                $updateGraphic->bindValue(':id', intval($row['id']), SQLITE3_INTEGER);
                if ($updateGraphic->execute() === false) {
                    throw new Exception('Could not repair Graphics preview for G#' . $cleanG . ': ' . $db->lastErrorMsg());
                }
                $summary['graphics_preview_repaired']++;
            }

            $findLatestRevision->reset();
            $findLatestRevision->clear();
            $findLatestRevision->bindValue(':g_number', $cleanG);
            $latestRevision = $findLatestRevision->execute()->fetchArray(SQLITE3_ASSOC);

            if ($latestRevision && !empty($latestRevision['id'])) {
                $updateRevision->reset();
                $updateRevision->clear();
                $updateRevision->bindValue(':approval_pdf', $expectedApproval);
                $updateRevision->bindValue(':id', intval($latestRevision['id']), SQLITE3_INTEGER);
                if ($updateRevision->execute() === false) {
                    throw new Exception('Could not repair approval revision link for G#' . $cleanG . ': ' . $db->lastErrorMsg());
                }
                $summary['revision_pdf_repaired']++;
            }
        }

        $db->exec('COMMIT');
    } catch (Exception $e) {
        $db->exec('ROLLBACK');
        $summary['errors'][] = $e->getMessage();
    }

    return $summary;
}

$databaseHealthReport = getDatabaseHealthReport($db);

$validAdminTabs = ['graphics', 'vendor', 'tools'];
$adminTab = $_GET['tab'] ?? '';

if (!in_array($adminTab, $validAdminTabs, true)) {
    if (isset($_GET['edit_vendor']) || isset($_GET['vendor_admin_search']) || isset($_GET['vendor_added']) || isset($_GET['vendor_updated']) || isset($_GET['vendor_deleted']) || isset($_GET['vendor_error'])) {
        $adminTab = 'vendor';
    } elseif (isset($_GET['backup']) || isset($_GET['download_backup'])) {
        $adminTab = 'tools';
    } else {
        $adminTab = 'graphics';
    }
}

$adminTabClass = function ($tab) use ($adminTab) {
    return $adminTab === $tab ? 'active' : '';
};


$db->exec("
CREATE TABLE IF NOT EXISTS graphics (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    g_number TEXT UNIQUE,
    customer_number TEXT NOT NULL,
    customer_name TEXT NOT NULL,
    part_number TEXT NOT NULL,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
");

$columns = $db->query("PRAGMA table_info(graphics)");
$hasPreviewImage = false;

while ($column = $columns->fetchArray(SQLITE3_ASSOC)) {
    if ($column['name'] === 'preview_image') {
        $hasPreviewImage = true;
        break;
    }
}

if (!$hasPreviewImage) {
    $db->exec("ALTER TABLE graphics ADD COLUMN preview_image TEXT");
}

$db->exec("
CREATE TABLE IF NOT EXISTS approval_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    g_number TEXT NOT NULL,
    rev TEXT,
    rev_date TEXT,
    description TEXT,
    csr TEXT,
    dsr TEXT,
    approval_pdf TEXT,
    snapshot_image TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
");

$approvalRevisionColumns = [];
$approvalCols = $db->query("PRAGMA table_info(approval_revisions)");
while ($approvalCol = $approvalCols->fetchArray(SQLITE3_ASSOC)) {
    $approvalRevisionColumns[] = $approvalCol['name'];
}

$approvalRevisionNeededColumns = [
    'g_number' => 'TEXT',
    'rev' => 'TEXT',
    'rev_date' => 'TEXT',
    'description' => 'TEXT',
    'csr' => 'TEXT',
    'dsr' => 'TEXT',
    'approval_pdf' => 'TEXT',
    'snapshot_image' => 'TEXT'
];

foreach ($approvalRevisionNeededColumns as $colName => $colType) {
    if (!in_array($colName, $approvalRevisionColumns, true)) {
        $db->exec("ALTER TABLE approval_revisions ADD COLUMN " . $colName . " " . $colType);
    }
}


function cleanNumberOnly($value) {
    return preg_replace('/[^0-9]/', '', $value ?? '');
}

function safePath($path) {
    return str_replace(['../', '..\\'], '', $path ?? '');
}


function gm2PreviewSafePath($path) {
    if (function_exists('safePath')) {
        return safePath($path);
    }
    $path = trim((string)$path);
    $path = str_replace(['../', '..\\'], '', $path);
    return ltrim($path, '/');
}

function gm2FindGhostscriptForPdfPreview() {
    $candidates = [
        '/usr/local/bin/gs',
        '/opt/homebrew/bin/gs',
        '/usr/bin/gs',
        '/opt/local/bin/gs',
        '/Applications/XAMPP/xamppfiles/bin/gs'
    ];

    foreach ($candidates as $candidate) {
        if (file_exists($candidate) && is_executable($candidate)) {
            return $candidate;
        }
    }

    $whichOutput = [];
    $whichReturn = 1;
    exec('PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin which gs 2>&1', $whichOutput, $whichReturn);

    if ($whichReturn === 0 && !empty($whichOutput[0]) && file_exists(trim($whichOutput[0]))) {
        return trim($whichOutput[0]);
    }

    return '';
}

function gm2PdfPreviewImageResponse($rawPath) {
    $pdfWebPath = gm2PreviewSafePath($rawPath);
    $pdfWebPath = str_replace('\\', '/', $pdfWebPath);
    $pdfWebPath = ltrim($pdfWebPath, '/');

    $allowedFolders = [
        'approvals/',
        'approval_revisions_pdfs/',
        'vendor_approvals/'
    ];

    $allowed = false;
    foreach ($allowedFolders as $folder) {
        if (strpos($pdfWebPath, $folder) === 0) {
            $allowed = true;
            break;
        }
    }

    if (!$allowed || strtolower(pathinfo($pdfWebPath, PATHINFO_EXTENSION)) !== 'pdf') {
        http_response_code(400);
        exit('Invalid PDF preview path.');
    }

    $pdfFullPath = __DIR__ . '/' . $pdfWebPath;
    if (!is_file($pdfFullPath)) {
        http_response_code(404);
        exit('PDF not found.');
    }

    $previewDir = __DIR__ . '/approval_preview_cache';
    if (!is_dir($previewDir)) {
        mkdir($previewDir, 0777, true);
    }
    @chmod($previewDir, 0777);

    $cacheKey = md5($pdfWebPath . '|' . filemtime($pdfFullPath) . '|' . filesize($pdfFullPath));
    $jpgPath = $previewDir . '/' . $cacheKey . '.jpg';

    if (!is_file($jpgPath) || filesize($jpgPath) <= 0) {
        $gs = gm2FindGhostscriptForPdfPreview();
        if (!$gs) {
            http_response_code(500);
            exit('Ghostscript was not found for PDF preview rendering.');
        }

        $tempDir = __DIR__ . '/magick_tmp';
        if (!is_dir($tempDir)) {
            mkdir($tempDir, 0777, true);
        }
        @chmod($tempDir, 0777);

        $cmd =
            'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
            'TMPDIR=' . escapeshellarg($tempDir) . ' ' .
            'TEMP=' . escapeshellarg($tempDir) . ' ' .
            'TMP=' . escapeshellarg($tempDir) . ' ' .
            'GS_TMPDIR=' . escapeshellarg($tempDir) . ' ' .
            escapeshellcmd($gs) .
            ' -dSAFER' .
            ' -dBATCH' .
            ' -dNOPAUSE' .
            ' -dFirstPage=1' .
            ' -dLastPage=1' .
            ' -sDEVICE=jpeg' .
            ' -dJPEGQ=92' .
            ' -r150' .
            ' -dGraphicsAlphaBits=4' .
            ' -dTextAlphaBits=4' .
            ' -sOutputFile=' . escapeshellarg($jpgPath) .
            ' ' . escapeshellarg($pdfFullPath) .
            ' 2>&1';

        exec($cmd, $out, $ret);

        if ($ret !== 0 || !is_file($jpgPath) || filesize($jpgPath) <= 0) {
            http_response_code(500);
            exit('Could not render PDF preview: ' . implode("\n", $out));
        }
    }

    if (ob_get_level()) {
        while (ob_get_level()) {
            ob_end_clean();
        }
    }

    header('Content-Type: image/jpeg');
    header('Content-Length: ' . filesize($jpgPath));
    header('Cache-Control: private, max-age=60');
    header('X-Content-Type-Options: nosniff');

    readfile($jpgPath);
    exit;
}

if (isset($_GET['gm2_pdf_preview']) && $_GET['gm2_pdf_preview'] === '1') {
    gm2PdfPreviewImageResponse($_GET['file'] ?? '');
}


/* Early JSON handler for Graphics preview deletion.
   Keep this before other POST handlers so AJAX never falls through into page HTML. */
if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'delete_approval_preview') {
    ini_set('display_errors', '0');
    error_reporting(E_ALL);

    while (ob_get_level() > 0) {
        ob_end_clean();
    }

    header('Content-Type: application/json');

    try {
        $id = intval($_POST['id'] ?? 0);

        if ($id <= 0) {
            throw new Exception('Missing record ID.');
        }

        $stmt = $db->prepare("\n            SELECT g_number, preview_image\n            FROM graphics\n            WHERE id = :id\n            LIMIT 1\n        ");
        $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
        $result = $stmt->execute();
        $row = $result->fetchArray(SQLITE3_ASSOC);

        if (!$row || empty($row['preview_image'])) {
            throw new Exception('No approval preview was found for this G#.');
        }

        $previewPath = str_replace(['../', '..\\'], '', (string)$row['preview_image']);
        $fullPath = __DIR__ . '/' . $previewPath;

        $canDeleteFile = (
            strpos($previewPath, 'approvals/') === 0 ||
            strpos($previewPath, 'uploads/') === 0
        );

        if ($canDeleteFile && file_exists($fullPath)) {
            @unlink($fullPath);
        }

        $pdfFullPath = preg_replace('/\.(jpg|jpeg|png|webp)$/i', '.pdf', $fullPath);
        if ($pdfFullPath && $pdfFullPath !== $fullPath && file_exists($pdfFullPath)) {
            @unlink($pdfFullPath);
        }

        $update = $db->prepare("\n            UPDATE graphics\n            SET preview_image = NULL\n            WHERE id = :id\n        ");
        $update->bindValue(':id', $id, SQLITE3_INTEGER);
        $update->execute();

        $cleanGForDelete = preg_replace('/[^0-9]/', '', (string)($row['g_number'] ?? ''));

        if ($cleanGForDelete !== '') {
            $clearApprovalRevisionPdf = $db->prepare("\n                UPDATE approval_revisions\n                SET approval_pdf = ''\n                WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number\n                  AND (approval_pdf = :preview_path OR approval_pdf LIKE 'approvals/%')\n            ");
            $clearApprovalRevisionPdf->bindValue(':g_number', $cleanGForDelete);
            $clearApprovalRevisionPdf->bindValue(':preview_path', $previewPath);
            $clearApprovalRevisionPdf->execute();
        }

        echo json_encode([
            'success' => true,
            'message' => 'Preview removed from ' . ($row['g_number'] ?? 'G#') . ($canDeleteFile ? ' and file deleted.' : '.'),
            'id' => $id,
            'g_number' => $row['g_number'] ?? '',
            'preview_image' => ''
        ]);
    } catch (Throwable $e) {
        http_response_code(200);
        echo json_encode([
            'success' => false,
            'message' => $e->getMessage()
        ]);
    }

    exit;
}

function forceUpperText($value) {
    return strtoupper(trim((string)($value ?? '')));
}

function cleanArtIdentifier($value) {
    $value = strtoupper(trim((string)($value ?? '')));
    $value = preg_replace('/\s+/', '', $value);
    return preg_replace('/[^A-Z0-9#_\-]/', '', $value);
}

function getVendorOptions() {
    return [
        'Impact Imaging' => 'I',
        'DieCo' => 'DC',
        'SGK' => 'SGK',
        'Mark Trace' => 'MT'
    ];
}

function cleanVendorRawNumber($value) {
    $value = strtoupper(trim((string)($value ?? '')));
    $value = preg_replace('/\s+/', '', $value);
    return preg_replace('/[^A-Z0-9#_\-]/', '', $value);
}

function buildVendorArtNumber($vendorPrefix, $rawNumber) {
    $prefix = strtoupper(trim((string)$vendorPrefix));
    $raw = cleanVendorRawNumber($rawNumber);

    if ($prefix === '' || $raw === '') {
        return '';
    }

    if (strpos($raw, $prefix . '#') === 0) {
        return $prefix . '#' . ltrim(substr($raw, strlen($prefix . '#')), '#-_');
    }

    if (strpos($raw, '#') !== false) {
        $parts = explode('#', $raw, 2);
        $raw = ltrim($parts[1] ?? '', '#-_');
    }

    if (strpos($raw, $prefix) === 0) {
        $raw = substr($raw, strlen($prefix));
        $raw = ltrim($raw, '#-_');
    }

    return $prefix . '#' . $raw;
}

function findPdftkBinaryForAdminVendor() {
    $candidates = [
        '/usr/local/bin/pdftk',
        '/opt/homebrew/bin/pdftk',
        '/usr/bin/pdftk',
        '/opt/local/bin/pdftk',
        '/Applications/XAMPP/xamppfiles/bin/pdftk'
    ];

    foreach ($candidates as $candidate) {
        if (file_exists($candidate) && is_executable($candidate)) {
            return $candidate;
        }
    }

    $whichOutput = [];
    $whichReturn = 1;
    exec('PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin which pdftk 2>&1', $whichOutput, $whichReturn);

    if ($whichReturn === 0 && !empty($whichOutput[0]) && file_exists(trim($whichOutput[0]))) {
        return trim($whichOutput[0]);
    }

    return '';
}

function normalizePdfFieldNameForAdminVendor($name) {
    return strtoupper(preg_replace('/[^A-Z0-9]/i', '', (string)$name));
}

function readVendorApprovalPdfFields($pdfWebPath) {
    $pdfWebPath = safePath($pdfWebPath);

    if (!$pdfWebPath || strpos($pdfWebPath, 'vendor_approvals/') !== 0 || strtolower(pathinfo($pdfWebPath, PATHINFO_EXTENSION)) !== 'pdf') {
        throw new Exception('Vendor approval PDF path is not valid.');
    }

    $pdfFullPath = __DIR__ . '/' . $pdfWebPath;

    if (!file_exists($pdfFullPath)) {
        throw new Exception('Vendor approval PDF file does not exist.');
    }

    $pdftk = findPdftkBinaryForAdminVendor();

    if (!$pdftk) {
        throw new Exception('pdftk was not found, so vendor approval fields could not be read.');
    }

    $cmd =
        'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
        escapeshellcmd($pdftk) . ' ' .
        escapeshellarg($pdfFullPath) . ' ' .
        'dump_data_fields_utf8 2>&1';

    exec($cmd, $out, $ret);

    if ($ret !== 0) {
        throw new Exception('Could not read vendor approval PDF fields: ' . implode("\n", $out));
    }

    $fields = [];
    $currentName = null;

    foreach ($out as $line) {
        if (strpos($line, 'FieldName:') === 0) {
            $currentName = trim(substr($line, strlen('FieldName:')));
            if (!array_key_exists($currentName, $fields)) {
                $fields[$currentName] = '';
            }
        } elseif (strpos($line, 'FieldValue:') === 0 && $currentName !== null) {
            $fields[$currentName] = trim(substr($line, strlen('FieldValue:')));
        }
    }

    return $fields;
}

function pickVendorPdfFieldValue($fields, $possibleNames) {
    $normalized = [];

    foreach ($fields as $name => $value) {
        $normalized[normalizePdfFieldNameForAdminVendor($name)] = trim((string)$value);
    }

    foreach ($possibleNames as $name) {
        $key = normalizePdfFieldNameForAdminVendor($name);
        if (array_key_exists($key, $normalized) && $normalized[$key] !== '') {
            return $normalized[$key];
        }
    }

    return '';
}

function extractVendorDefaultsFromApprovalPdfForAdmin($pdfWebPath) {
    $fields = readVendorApprovalPdfFields($pdfWebPath);

    $mapped = [
        'vendor_raw_number' => pickVendorPdfFieldValue($fields, [
            'ART #', 'ART#', 'ART NUMBER', 'ART NO', 'G#', 'G #', 'G NUMBER', 'G NO',
            'GRAPHICS #', 'GRAPHICS NUMBER', 'GRAPHIC #', 'GRAPHIC NUMBER'
        ]),
        'customer_number' => pickVendorPdfFieldValue($fields, [
            'CUST #', 'CUST#', 'CUST. #', 'CUST. NO', 'CUST NO', 'CUST NUMBER', 'CUST ID', 'CUST CODE',
            'CUSTOMER #', 'CUSTOMER#', 'CUSTOMER NO', 'CUSTOMER ID', 'CUSTOMER CODE', 'CUSTOMER ACCOUNT',
            'ACCT #', 'ACCOUNT #', 'ACCOUNT NUMBER'
        ]),
        'customer_name' => pickVendorPdfFieldValue($fields, [
            'CUSTOMER NAME', 'CUST NAME', 'CLIENT NAME', 'COMPANY NAME', 'CUSTOMER', 'CLIENT', 'COMPANY'
        ]),
        'part_number' => pickVendorPdfFieldValue($fields, [
            'I.D',
            'ID',
            'I D',
            'ITEM ID',
            'ITEM I.D',
            'ITEM I.D.',
            'ITEM DESCRIPTION',
            'ITEM DESC',
            'DESCRIPTION OF ITEM',
            'ITEM DESCRIPTION/PART #',
            'PART DESCRIPTION',
            'PART DESC',
            'PRODUCT DESCRIPTION',
            'PRODUCT DESC',
            'PART #',
            'PART#',
            'PART NUMBER',
            'PART NO',
            'ITEM #',
            'ITEM#',
            'ITEM NUMBER',
            'ITEM NO',
            'ITEM',
            'DESCRIPTION',
            'PRODUCT',
            'STYLE #',
            'STYLE NUMBER',
            'SKU'
        ])
    ];

    foreach ($mapped as $key => $value) {
        $mapped[$key] = strtoupper(trim((string)$value));
    }

    return $mapped;
}

function findPdftkBinaryForExistingApprovalImport() {
    $candidates = [
        '/usr/local/bin/pdftk',
        '/opt/homebrew/bin/pdftk',
        '/usr/bin/pdftk',
        '/opt/local/bin/pdftk',
        '/Applications/XAMPP/xamppfiles/bin/pdftk'
    ];

    foreach ($candidates as $candidate) {
        if (file_exists($candidate) && is_executable($candidate)) {
            return $candidate;
        }
    }

    $whichOutput = [];
    $whichReturn = 1;
    exec('PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin which pdftk 2>&1', $whichOutput, $whichReturn);

    if ($whichReturn === 0 && !empty($whichOutput[0]) && file_exists(trim($whichOutput[0]))) {
        return trim($whichOutput[0]);
    }

    return '';
}

function readExistingApprovalImportPdfFields($pdfFullPath) {
    if (!file_exists($pdfFullPath)) {
        throw new Exception('Uploaded approval PDF could not be found after upload.');
    }

    $pdftk = findPdftkBinaryForExistingApprovalImport();

    if (!$pdftk) {
        throw new Exception('pdftk was not found, so the approval PDF fields could not be read.');
    }

    $cmd =
        'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
        escapeshellcmd($pdftk) . ' ' .
        escapeshellarg($pdfFullPath) . ' ' .
        'dump_data_fields_utf8 2>&1';

    exec($cmd, $out, $ret);

    if ($ret !== 0) {
        throw new Exception('Could not read approval PDF fields: ' . implode("\n", $out));
    }

    $fields = [];
    $currentName = null;

    foreach ($out as $line) {
        if (strpos($line, '---') === 0) {
            $currentName = null;
            continue;
        }

        if (strpos($line, 'FieldName:') === 0) {
            $currentName = trim(substr($line, strlen('FieldName:')));
            if ($currentName !== '' && !array_key_exists($currentName, $fields)) {
                $fields[$currentName] = '';
            }
            continue;
        }

        if (strpos($line, 'FieldValue:') === 0 && $currentName !== null) {
            $fields[$currentName] = trim(substr($line, strlen('FieldValue:')));
        }
    }

    return $fields;
}

function normalizeExistingApprovalImportFieldName($name) {
    return strtoupper(preg_replace('/[^A-Z0-9]/i', '', (string)$name));
}

function getExistingApprovalImportField($fields, $possibleNames) {
    $normalized = [];

    foreach ($fields as $name => $value) {
        $normalized[normalizeExistingApprovalImportFieldName($name)] = trim((string)$value);
    }

    foreach ($possibleNames as $name) {
        $key = normalizeExistingApprovalImportFieldName($name);
        if (array_key_exists($key, $normalized) && $normalized[$key] !== '') {
            return $normalized[$key];
        }
    }

    return '';
}

function parseExistingApprovalImportArtNumber($artNumber) {
    $artNumber = strtoupper(trim((string)$artNumber));
    $artNumber = preg_replace('/\s+/', '', $artNumber);

    if ($artNumber === '') {
        return ['g_number' => '', 'current_rev' => ''];
    }

    $artNumber = preg_replace('/^G#?/i', '', $artNumber);
    $artNumber = preg_replace('/^ART#?/i', '', $artNumber);
    $artNumber = ltrim($artNumber, '#');

    $currentRev = '';
    if (preg_match('/^(\d+)[\-_]([A-Z0-9]+)$/i', $artNumber, $matches)) {
        return [
            'g_number' => $matches[1],
            'current_rev' => strtoupper($matches[2])
        ];
    }

    return [
        'g_number' => preg_replace('/[^0-9]/', '', $artNumber),
        'current_rev' => $currentRev
    ];
}

function buildExistingApprovalRevisionRows($fields) {
    $rows = [];

    for ($i = 0; $i < 4; $i++) {
        $rev = getExistingApprovalImportField($fields, ['ART REV ' . $i, 'ARTREV' . $i, 'REV ' . $i, 'REV' . $i]);
        $revDate = getExistingApprovalImportField($fields, ['rev date ' . $i, 'REV DATE ' . $i, 'REVDATE' . $i]);
        $description = getExistingApprovalImportField($fields, ['DESCR ' . $i, 'DESCRIPTION ' . $i, 'DESC ' . $i]);
        $csr = getExistingApprovalImportField($fields, ['CSR ' . $i, 'CSR' . $i]);
        $dsr = getExistingApprovalImportField($fields, ['DSR ' . $i, 'DSR' . $i]);

        if (trim($rev) === '' && trim($revDate) === '' && trim($description) === '' && trim($csr) === '' && trim($dsr) === '') {
            continue;
        }

        $rows[] = [
            'rev' => strtoupper(trim((string)$rev)),
            'rev_date' => strtoupper(trim((string)$revDate)),
            'description' => strtoupper(trim((string)$description)),
            'csr' => strtoupper(trim((string)$csr)),
            'dsr' => strtoupper(trim((string)$dsr))
        ];
    }

    return $rows;
}

function getHighestExistingApprovalRevisionIndex($rows) {
    if (empty($rows)) {
        return -1;
    }

    $highestIndex = 0;
    $highestNumeric = -1;

    foreach ($rows as $index => $row) {
        $rev = strtoupper(trim((string)($row['rev'] ?? '')));
        if (preg_match('/^\d+$/', $rev)) {
            $num = intval($rev);
            if ($num >= $highestNumeric) {
                $highestNumeric = $num;
                $highestIndex = $index;
            }
        } elseif ($highestNumeric < 0) {
            $highestIndex = $index;
        }
    }

    return $highestIndex;
}

function saveExistingApprovalImportPdf($file, $cleanGNumber) {
    if (!isset($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        throw new Exception('Please choose an approval PDF to import.');
    }

    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK || empty($file['tmp_name'])) {
        throw new Exception('Approval PDF upload failed.');
    }

    $uploadedName = $file['name'] ?? '';
    $ext = strtolower(pathinfo($uploadedName, PATHINFO_EXTENSION));

    if ($ext !== 'pdf') {
        throw new Exception('Imported approval must be a PDF.');
    }

    $approvalDir = __DIR__ . '/approvals';
    if (!is_dir($approvalDir)) {
        mkdir($approvalDir, 0777, true);
    }
    @chmod($approvalDir, 0777);

    $approvalFileName = $cleanGNumber . '_APPROVAL.pdf';
    $approvalFullPath = $approvalDir . '/' . $approvalFileName;

    if (file_exists($approvalFullPath)) {
        @unlink($approvalFullPath);
    }

    if (!move_uploaded_file($file['tmp_name'], $approvalFullPath)) {
        throw new Exception('Could not save imported approval PDF.');
    }

    return [
        'full_path' => $approvalFullPath,
        'web_path' => 'approvals/' . $approvalFileName
    ];
}

function importExistingApprovalPdfIntoSystem($db, $file) {
    if (!isset($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        throw new Exception('Please choose an approval PDF to import.');
    }

    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK || empty($file['tmp_name'])) {
        throw new Exception('Approval PDF upload failed.');
    }

    $fields = readExistingApprovalImportPdfFields($file['tmp_name']);

    $artNumber = getExistingApprovalImportField($fields, ['ART #', 'ART#', 'GRAPHICS #', 'GRAPHICS#', 'G#', 'G #']);
    $parsedArt = parseExistingApprovalImportArtNumber($artNumber);
    $cleanG = $parsedArt['g_number'];

    if ($cleanG === '') {
        throw new Exception('Could not find a valid G# from the approval PDF ART # field.');
    }

    $gNumber = 'G#' . intval($cleanG);
    $cleanG = (string)intval($cleanG);

    $customerNumber = forceUpperText(getExistingApprovalImportField($fields, ['CUST #', 'CUST#', 'CUSTOMER #', 'CUSTOMER#', 'CUSTOMER NUMBER', 'CUST NUMBER']));
    $customerName = forceUpperText(getExistingApprovalImportField($fields, ['CUSTOMER', 'CUSTOMER NAME', 'CUST NAME']));
    $partNumber = forceUpperText(getExistingApprovalImportField($fields, ['I.D', 'ID', 'ITEM DESCRIPTION', 'ITEM DESC', 'PART #', 'PART#', 'PART NUMBER', 'DESCRIPTION']));

    if ($customerNumber === '' || $customerName === '' || $partNumber === '') {
        throw new Exception('The approval PDF is missing required customer or item fields.');
    }

    $existingGraphicStmt = $db->prepare("\n        SELECT *\n        FROM graphics\n        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number\n        LIMIT 1\n    ");
    $existingGraphicStmt->bindValue(':g_number', $cleanG);
    $existingGraphic = $existingGraphicStmt->execute()->fetchArray(SQLITE3_ASSOC);

    if ($existingGraphic && !empty($existingGraphic['preview_image']) && strpos((string)$existingGraphic['preview_image'], 'approvals/') === 0) {
        $existingApprovalPath = safePath((string)$existingGraphic['preview_image']);
        $importerApprovalPath = 'approvals/' . $cleanG . '_APPROVAL.pdf';

        // Allow this importer to rebuild/repair its own imported approval.
        // Block only when a different approval PDF is already attached.
        if ($existingApprovalPath !== $importerApprovalPath) {
            throw new Exception($gNumber . ' already has an approval PDF attached. Import cancelled.');
        }
    }

    $savedApproval = saveExistingApprovalImportPdf($file, $cleanG);
    $approvalWeb = $savedApproval['web_path'];

    $revisionRows = buildExistingApprovalRevisionRows($fields);
    if (empty($revisionRows)) {
        $currentRev = $parsedArt['current_rev'] !== '' ? $parsedArt['current_rev'] : '0';
        $revisionRows[] = [
            'rev' => $currentRev,
            'rev_date' => forceUpperText(getExistingApprovalImportField($fields, ['APPROVAL CREATION DATE', 'APPROVAL DATE', 'DATE'])),
            'description' => 'IMPORTED APPROVAL',
            'csr' => '',
            'dsr' => ''
        ];
    }

    $currentRevisionIndex = getHighestExistingApprovalRevisionIndex($revisionRows);

    $db->exec('BEGIN TRANSACTION');

    try {
        if ($existingGraphic) {
            $updateGraphic = $db->prepare("\n                UPDATE graphics\n                SET customer_number = :customer_number,\n                    customer_name = :customer_name,\n                    part_number = :part_number,\n                    preview_image = :preview_image\n                WHERE id = :id\n            ");
            $updateGraphic->bindValue(':customer_number', $customerNumber);
            $updateGraphic->bindValue(':customer_name', $customerName);
            $updateGraphic->bindValue(':part_number', $partNumber);
            $updateGraphic->bindValue(':preview_image', $approvalWeb);
            $updateGraphic->bindValue(':id', intval($existingGraphic['id']), SQLITE3_INTEGER);
            $graphicUpdated = $updateGraphic->execute();
            if ($graphicUpdated === false) {
                throw new Exception('Could not update the existing Graphics record during approval import: ' . $db->lastErrorMsg());
            }
            $graphicAction = 'updated';
        } else {
            $insertGraphic = $db->prepare("\n                INSERT INTO graphics\n                (g_number, customer_number, customer_name, part_number, preview_image)\n                VALUES\n                (:g_number, :customer_number, :customer_name, :part_number, :preview_image)\n            ");
            $insertGraphic->bindValue(':g_number', $gNumber);
            $insertGraphic->bindValue(':customer_number', $customerNumber);
            $insertGraphic->bindValue(':customer_name', $customerName);
            $insertGraphic->bindValue(':part_number', $partNumber);
            $insertGraphic->bindValue(':preview_image', $approvalWeb);
            $graphicInserted = $insertGraphic->execute();
            if ($graphicInserted === false) {
                throw new Exception('Could not create the Graphics record during approval import: ' . $db->lastErrorMsg());
            }
            $graphicAction = 'created';
        }

        $deleteExistingRevs = $db->prepare("\n            DELETE FROM approval_revisions\n            WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number\n        ");
        $deleteExistingRevs->bindValue(':g_number', $cleanG);
        $deletedExistingRevs = $deleteExistingRevs->execute();
        if ($deletedExistingRevs === false) {
            throw new Exception('Could not clear old approval revision rows before import: ' . $db->lastErrorMsg());
        }

        $insertApprovalRevision = $db->prepare("\n            INSERT INTO approval_revisions\n            (g_number, rev, rev_date, description, csr, dsr, approval_pdf, snapshot_image)\n            VALUES\n            (:g_number, :rev, :rev_date, :description, :csr, :dsr, :approval_pdf, '')\n        ");

        foreach ($revisionRows as $index => $row) {
            $insertApprovalRevision->reset();
            $insertApprovalRevision->clear();
            $insertApprovalRevision->bindValue(':g_number', $cleanG);
            $insertApprovalRevision->bindValue(':rev', $row['rev']);
            $insertApprovalRevision->bindValue(':rev_date', $row['rev_date']);
            $insertApprovalRevision->bindValue(':description', $row['description']);
            $insertApprovalRevision->bindValue(':csr', $row['csr']);
            $insertApprovalRevision->bindValue(':dsr', $row['dsr']);
            $insertApprovalRevision->bindValue(':approval_pdf', $index === $currentRevisionIndex ? $approvalWeb : '');
            $revisionInserted = $insertApprovalRevision->execute();
            if ($revisionInserted === false) {
                throw new Exception('Could not insert approval revision row during import: ' . $db->lastErrorMsg());
            }
        }

        $verifyImportedRevisions = $db->prepare("
            SELECT COUNT(*) AS total_rows
            FROM approval_revisions
            WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
        ");
        $verifyImportedRevisions->bindValue(':g_number', $cleanG);
        $verifyRow = $verifyImportedRevisions->execute()->fetchArray(SQLITE3_ASSOC);
        $verifiedRevisionCount = intval($verifyRow['total_rows'] ?? 0);

        if ($verifiedRevisionCount <= 0) {
            throw new Exception('The approval import finished, but no approval revision rows were found after insert.');
        }

        $currentLast = intval($db->querySingle("SELECT value FROM settings WHERE key = 'last_g_number'"));
        if (intval($cleanG) > $currentLast) {
            $stmtUpdate = $db->prepare("UPDATE settings SET value = :value WHERE key = 'last_g_number'");
            $stmtUpdate->bindValue(':value', intval($cleanG));
            $stmtUpdate->execute();
        }

        $db->exec('COMMIT');
    } catch (Exception $e) {
        $db->exec('ROLLBACK');
        if (file_exists($savedApproval['full_path'])) {
            @unlink($savedApproval['full_path']);
        }
        throw $e;
    }

    return [
        'g_number' => $gNumber,
        'clean_g_number' => $cleanG,
        'graphic_action' => $graphicAction,
        'revision_count' => $verifiedRevisionCount ?? count($revisionRows),
        'approval_pdf' => $approvalWeb,
        'customer_name' => $customerName,
        'customer_number' => $customerNumber,
        'part_number' => $partNumber,
        'current_rev' => $revisionRows[$currentRevisionIndex]['rev'] ?? ''
    ];
}

function saveVendorApprovalUpload($file, $vendorArtNumber = '') {
    if (!isset($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return '';
    }

    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK || empty($file['tmp_name'])) {
        throw new Exception('Vendor approval upload failed.');
    }

    $uploadedName = $file['name'] ?? '';
    $uploadedExt = strtolower(pathinfo($uploadedName, PATHINFO_EXTENSION));

    if ($uploadedExt !== 'pdf') {
        throw new Exception('Vendor approval must be a PDF.');
    }

    $vendorDir = __DIR__ . '/vendor_approvals';
    if (!is_dir($vendorDir)) {
        mkdir($vendorDir, 0777, true);
    }
    @chmod($vendorDir, 0777);

    $base = $vendorArtNumber ? preg_replace('/[^A-Z0-9_-]/', '_', str_replace('#', '_', cleanArtIdentifier($vendorArtNumber))) : 'vendor_upload';
    $fileName = $base . '_APPROVAL_' . time() . '_' . mt_rand(1000, 9999) . '.pdf';
    $fullPath = $vendorDir . '/' . $fileName;

    if (!move_uploaded_file($file['tmp_name'], $fullPath)) {
        throw new Exception('Could not save the uploaded vendor approval PDF.');
    }

    return 'vendor_approvals/' . $fileName;
}

function cleanRepairImportCell($value) {
    $value = trim((string)$value);
    $value = preg_replace('/^\xEF\xBB\xBF/', '', $value);
    $value = trim($value);

    // Prevent accidental decimal suffixes from Customer No or Graphics Number.
    if (preg_match('/^\d+\.0$/', $value)) {
        $value = preg_replace('/\.0$/', '', $value);
    }

    return $value;
}

function normalizeRepairGNumber($value) {
    $value = cleanRepairImportCell($value);
    $value = strtoupper(str_replace([' ', '#'], '', $value));
    $value = str_replace('G', '', $value);

    if ($value === '' || !preg_match('/^\d+$/', $value)) {
        return '';
    }

    return 'G#' . intval($value);
}



$db->exec("
CREATE TABLE IF NOT EXISTS settings (
    key TEXT PRIMARY KEY,
    value TEXT NOT NULL
)
");

$lastNumber = $db->querySingle("SELECT value FROM settings WHERE key = 'last_g_number'");

if (!$lastNumber) {
    $db->exec("INSERT INTO settings (key, value) VALUES ('last_g_number', '12855')");
}

$editEntry = null;

if (isset($_GET['edit'])) {
    $editId = intval($_GET['edit']);
    $stmt = $db->prepare("SELECT * FROM graphics WHERE id = :id");
    $stmt->bindValue(':id', $editId, SQLITE3_INTEGER);
    $editEntry = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
}



if (isset($_POST['repair_import_csv'])) {
    $summary = [
        'inserted' => 0,
        'updated' => 0,
        'skipped_invalid' => 0,
        'highest_number' => 0,
        'errors' => []
    ];

    if (!isset($_FILES['repair_csv_file']) || $_FILES['repair_csv_file']['error'] !== UPLOAD_ERR_OK) {
        $summary['errors'][] = 'No CSV file was uploaded.';
    } else {
        $file = $_FILES['repair_csv_file']['tmp_name'];
        $handle = fopen($file, 'r');

        if (!$handle) {
            $summary['errors'][] = 'Could not open uploaded CSV file.';
        } else {
            $header = fgetcsv($handle);
            $headerMap = [];

            if ($header) {
                foreach ($header as $index => $name) {
                    $cleanHeader = strtolower(trim(preg_replace('/^\xEF\xBB\xBF/', '', $name)));
                    $headerMap[$cleanHeader] = $index;
                }
            }

            $gIndex = $headerMap['graphics number'] ?? $headerMap['g#'] ?? $headerMap['g_number'] ?? null;
            $customerNoIndex = $headerMap['customer no'] ?? $headerMap['customer #'] ?? $headerMap['customer number'] ?? null;
            $customerNameIndex = $headerMap['customer name'] ?? null;
            $partIndex = $headerMap['description of item'] ?? $headerMap['part #'] ?? $headerMap['part number'] ?? null;

            if ($gIndex === null || $customerNoIndex === null || $customerNameIndex === null || $partIndex === null) {
                $summary['errors'][] = 'CSV headers were not recognized. Expected: Graphics Number, Customer No, Customer Name, Description of Item.';
            } else {
                $db->exec('BEGIN TRANSACTION');

                $existsStmt = $db->prepare("SELECT COUNT(*) FROM graphics WHERE g_number = :g_number");

                $insertStmt = $db->prepare("
                    INSERT INTO graphics
                    (g_number, customer_number, customer_name, part_number)
                    VALUES
                    (:g_number, :customer_number, :customer_name, :part_number)
                ");

                $updateStmt = $db->prepare("
                    UPDATE graphics
                    SET customer_number = :customer_number,
                        customer_name = :customer_name,
                        part_number = :part_number
                    WHERE g_number = :g_number
                ");

                while (($row = fgetcsv($handle)) !== false) {
                    $gNumber = normalizeRepairGNumber($row[$gIndex] ?? '');
                    $customerNumber = cleanRepairImportCell($row[$customerNoIndex] ?? '');
                    $customerName = cleanRepairImportCell($row[$customerNameIndex] ?? '');
                    $partNumber = cleanRepairImportCell($row[$partIndex] ?? '');

                    if ($gNumber === '') {
                        $summary['skipped_invalid']++;
                        continue;
                    }

                    $numericG = intval(str_replace('G#', '', $gNumber));
                    if ($numericG > $summary['highest_number']) {
                        $summary['highest_number'] = $numericG;
                    }

                    $existsStmt->reset();
                    $existsStmt->clear();
                    $existsStmt->bindValue(':g_number', $gNumber);
                    $exists = intval($existsStmt->execute()->fetchArray(SQLITE3_NUM)[0] ?? 0);

                    if ($exists > 0) {
                        $updateStmt->reset();
                        $updateStmt->clear();
                        $updateStmt->bindValue(':g_number', $gNumber);
                        $updateStmt->bindValue(':customer_number', $customerNumber);
                        $updateStmt->bindValue(':customer_name', $customerName);
                        $updateStmt->bindValue(':part_number', $partNumber);
                        $updateStmt->execute();

                        $summary['updated']++;
                    } else {
                        $insertStmt->reset();
                        $insertStmt->clear();
                        $insertStmt->bindValue(':g_number', $gNumber);
                        $insertStmt->bindValue(':customer_number', $customerNumber);
                        $insertStmt->bindValue(':customer_name', $customerName);
                        $insertStmt->bindValue(':part_number', $partNumber);
                        $insertStmt->execute();

                        $summary['inserted']++;
                    }
                }

                $currentLast = intval($db->querySingle("SELECT value FROM settings WHERE key = 'last_g_number'"));
                if ($summary['highest_number'] > $currentLast) {
                    $stmtUpdate = $db->prepare("UPDATE settings SET value = :value WHERE key = 'last_g_number'");
                    $stmtUpdate->bindValue(':value', $summary['highest_number']);
                    $stmtUpdate->execute();
                }

                $db->exec('COMMIT');
            }

            fclose($handle);
        }
    }

    $_SESSION['repair_import_summary'] = $summary;
    header("Location: admin.php?tab=graphics&repair_imported=1");
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'import_existing_approval') {
    try {
        $summary = importExistingApprovalPdfIntoSystem($db, $_FILES['existing_approval_pdf'] ?? null);
        $_SESSION['existing_approval_import_summary'] = $summary;
        header('Location: admin.php?tab=tools&approval_imported=1');
        exit;
    } catch (Exception $e) {
        $_SESSION['existing_approval_import_error'] = $e->getMessage();
        header('Location: admin.php?tab=tools&approval_import_error=1');
        exit;
    }
}


if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'add_vendor_art') {
    try {
        $vendorOptions = getVendorOptions();
        $vendorName = trim((string)($_POST['vendor_name'] ?? ''));
        $vendorPrefix = $vendorOptions[$vendorName] ?? '';

        if ($vendorPrefix === '') {
            throw new Exception('Please select a valid vendor.');
        }

        $tempPdfWeb = saveVendorApprovalUpload($_FILES['vendor_approval_pdf'] ?? null);
        if ($tempPdfWeb === '') {
            throw new Exception('Please upload the vendor approval PDF.');
        }

        $defaults = extractVendorDefaultsFromApprovalPdfForAdmin($tempPdfWeb);

        $manualVendorRaw = cleanVendorRawNumber($_POST['vendor_raw_number'] ?? '');
        $vendorRawNumber = $manualVendorRaw !== '' ? $manualVendorRaw : cleanVendorRawNumber($defaults['vendor_raw_number'] ?? '');
        $vendorArtNumber = buildVendorArtNumber($vendorPrefix, $vendorRawNumber);

        if ($vendorArtNumber === '') {
            @unlink(__DIR__ . '/' . $tempPdfWeb);
            throw new Exception('The vendor art number could not be found. Make sure the vendor number is in the approval PDF G# / ART # field, or type it manually.');
        }

        $customerNumber = forceUpperText($_POST['vendor_customer_number'] ?? '') ?: forceUpperText($defaults['customer_number'] ?? '');
        $customerName = forceUpperText($_POST['vendor_customer_name'] ?? '') ?: forceUpperText($defaults['customer_name'] ?? '');
        $partNumber = forceUpperText($_POST['vendor_part_number'] ?? '') ?: forceUpperText($defaults['part_number'] ?? '');

        // Rename temporary upload with final vendor art number for cleaner file names.
        $finalPdfWeb = $tempPdfWeb;
        $oldFull = __DIR__ . '/' . $tempPdfWeb;
        if (file_exists($oldFull)) {
            $safeVendorFileBase = preg_replace('/[^A-Z0-9_-]/', '_', str_replace('#', '_', $vendorArtNumber));
            $finalName = $safeVendorFileBase . '_APPROVAL_' . time() . '.pdf';
            $finalFull = __DIR__ . '/vendor_approvals/' . $finalName;
            if (@rename($oldFull, $finalFull)) {
                $finalPdfWeb = 'vendor_approvals/' . $finalName;
            }
        }

        $existing = $db->prepare("SELECT preview_image FROM vendor_art WHERE vendor_art_number = :vendor_art_number LIMIT 1");
        $existing->bindValue(':vendor_art_number', $vendorArtNumber);
        $existingRow = $existing->execute()->fetchArray(SQLITE3_ASSOC);
        if ($existingRow && !empty($existingRow['preview_image'])) {
            $oldPreview = safePath($existingRow['preview_image']);
            if (strpos($oldPreview, 'vendor_approvals/') === 0 && file_exists(__DIR__ . '/' . $oldPreview)) {
                @unlink(__DIR__ . '/' . $oldPreview);
            }
        }

        $stmt = $db->prepare("\n            INSERT OR REPLACE INTO vendor_art\n            (vendor_name, vendor_prefix, vendor_raw_number, vendor_art_number, customer_number, customer_name, part_number, preview_image, last_updated)\n            VALUES\n            (:vendor_name, :vendor_prefix, :vendor_raw_number, :vendor_art_number, :customer_number, :customer_name, :part_number, :preview_image, CURRENT_TIMESTAMP)\n        ");
        $stmt->bindValue(':vendor_name', $vendorName);
        $stmt->bindValue(':vendor_prefix', $vendorPrefix);
        $stmt->bindValue(':vendor_raw_number', $vendorRawNumber);
        $stmt->bindValue(':vendor_art_number', $vendorArtNumber);
        $stmt->bindValue(':customer_number', $customerNumber);
        $stmt->bindValue(':customer_name', $customerName);
        $stmt->bindValue(':part_number', $partNumber);
        $stmt->bindValue(':preview_image', $finalPdfWeb);
        $stmt->execute();

        header('Location: admin.php?tab=vendor&vendor_added=' . urlencode($vendorArtNumber));
        exit;
    } catch (Exception $e) {
        header('Location: admin.php?tab=vendor&vendor_error=' . urlencode($e->getMessage()));
        exit;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'update_vendor_art') {
    try {
        $id = intval($_POST['vendor_id'] ?? 0);
        $vendorOptions = getVendorOptions();
        $vendorName = trim((string)($_POST['vendor_name'] ?? ''));
        $vendorPrefix = $vendorOptions[$vendorName] ?? '';
        $vendorRawNumber = cleanVendorRawNumber($_POST['vendor_raw_number'] ?? '');
        $vendorArtNumber = buildVendorArtNumber($vendorPrefix, $vendorRawNumber);
        $customerNumber = forceUpperText($_POST['vendor_customer_number'] ?? '');
        $customerName = forceUpperText($_POST['vendor_customer_name'] ?? '');
        $partNumber = forceUpperText($_POST['vendor_part_number'] ?? '');

        if ($id <= 0) {
            throw new Exception('Missing vendor record ID.');
        }
        if ($vendorPrefix === '') {
            throw new Exception('Please select a valid vendor.');
        }
        if ($vendorArtNumber === '') {
            throw new Exception('Vendor Art # is required.');
        }

        $lookup = $db->prepare("SELECT preview_image FROM vendor_art WHERE id = :id LIMIT 1");
        $lookup->bindValue(':id', $id, SQLITE3_INTEGER);
        $existing = $lookup->execute()->fetchArray(SQLITE3_ASSOC);
        if (!$existing) {
            throw new Exception('Vendor record was not found.');
        }

        $previewImage = safePath($existing['preview_image'] ?? '');
        $newPdf = saveVendorApprovalUpload($_FILES['vendor_approval_pdf'] ?? null, $vendorArtNumber);
        if ($newPdf !== '') {
            if ($previewImage && strpos($previewImage, 'vendor_approvals/') === 0 && file_exists(__DIR__ . '/' . $previewImage)) {
                @unlink(__DIR__ . '/' . $previewImage);
            }
            $previewImage = $newPdf;
        }

        $stmt = $db->prepare("\n            UPDATE vendor_art\n            SET vendor_name = :vendor_name,\n                vendor_prefix = :vendor_prefix,\n                vendor_raw_number = :vendor_raw_number,\n                vendor_art_number = :vendor_art_number,\n                customer_number = :customer_number,\n                customer_name = :customer_name,\n                part_number = :part_number,\n                preview_image = :preview_image,\n                last_updated = CURRENT_TIMESTAMP\n            WHERE id = :id\n        ");
        $stmt->bindValue(':vendor_name', $vendorName);
        $stmt->bindValue(':vendor_prefix', $vendorPrefix);
        $stmt->bindValue(':vendor_raw_number', $vendorRawNumber);
        $stmt->bindValue(':vendor_art_number', $vendorArtNumber);
        $stmt->bindValue(':customer_number', $customerNumber);
        $stmt->bindValue(':customer_name', $customerName);
        $stmt->bindValue(':part_number', $partNumber);
        $stmt->bindValue(':preview_image', $previewImage);
        $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
        $stmt->execute();

        header('Location: admin.php?tab=vendor&vendor_updated=' . urlencode($vendorArtNumber));
        exit;
    } catch (Exception $e) {
        header('Location: admin.php?tab=vendor&vendor_error=' . urlencode($e->getMessage()));
        exit;
    }
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'delete_vendor_art') {
    try {
        $id = intval($_POST['vendor_id'] ?? 0);
        if ($id <= 0) {
            throw new Exception('Missing vendor record ID.');
        }

        $lookup = $db->prepare("SELECT vendor_art_number, preview_image FROM vendor_art WHERE id = :id LIMIT 1");
        $lookup->bindValue(':id', $id, SQLITE3_INTEGER);
        $existing = $lookup->execute()->fetchArray(SQLITE3_ASSOC);
        if (!$existing) {
            throw new Exception('Vendor record was not found.');
        }

        $preview = safePath($existing['preview_image'] ?? '');
        if ($preview && strpos($preview, 'vendor_approvals/') === 0 && file_exists(__DIR__ . '/' . $preview)) {
            @unlink(__DIR__ . '/' . $preview);
        }

        $stmt = $db->prepare("DELETE FROM vendor_art WHERE id = :id");
        $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
        $stmt->execute();

        header('Location: admin.php?tab=vendor&vendor_deleted=' . urlencode($existing['vendor_art_number'] ?? 'Vendor Art'));
        exit;
    } catch (Exception $e) {
        header('Location: admin.php?tab=vendor&vendor_error=' . urlencode($e->getMessage()));
        exit;
    }
}

if (isset($_POST['upload_preview'])) {
    $id = intval($_POST['id']);
    $uploadSuccess = false;
    $uploadMessage = 'No file was uploaded.';
    $previewPath = '';

    if (isset($_FILES['preview_image']) && $_FILES['preview_image']['error'] === UPLOAD_ERR_OK) {
        $allowedTypes = ['image/jpeg', 'image/png', 'image/webp', 'application/pdf'];

        if (in_array($_FILES['preview_image']['type'], $allowedTypes)) {
            $entry = $db->querySingle("SELECT g_number FROM graphics WHERE id = $id", true);

            if ($entry) {
                if (!is_dir('uploads')) {
                    mkdir('uploads', 0777, true);
                }

                $safeGNumber = str_replace(['#', ' '], ['', '_'], $entry['g_number']);
                $extension = pathinfo($_FILES['preview_image']['name'], PATHINFO_EXTENSION);
                $fileName = $safeGNumber . '_' . time() . '.' . $extension;
                $targetPath = 'uploads/' . $fileName;

                if (move_uploaded_file($_FILES['preview_image']['tmp_name'], $targetPath)) {
                    $stmt = $db->prepare("UPDATE graphics SET preview_image = :preview_image WHERE id = :id");
                    $stmt->bindValue(':preview_image', $targetPath);
                    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
                    $stmt->execute();

                    $uploadSuccess = true;
                    $uploadMessage = 'Preview image uploaded successfully.';
                    $previewPath = $targetPath;
                } else {
                    $uploadMessage = 'Could not move uploaded file.';
                }
            } else {
                $uploadMessage = 'Could not find the selected G# record.';
            }
        } else {
            $uploadMessage = 'Invalid file type. Please upload JPG, PNG, WEBP, or PDF.';
        }
    }

    if (isset($_POST['ajax_upload']) && $_POST['ajax_upload'] === '1') {
        header('Content-Type: application/json');
        echo json_encode([
            'success' => $uploadSuccess,
            'message' => $uploadMessage,
            'preview_image' => $previewPath,
            'id' => $id
        ]);
        exit;
    }

    header("Location: admin.php?tab=graphics&uploaded=1");
    exit;
}

if (isset($_POST['update_entry'])) {
    $id = intval($_POST['id']);
    $customer_number = trim($_POST['customer_number']);
    $customer_name = trim($_POST['customer_name']);
    $part_number = trim($_POST['part_number']);

    $stmt = $db->prepare("
        UPDATE graphics
        SET customer_number = :customer_number,
            customer_name = :customer_name,
            part_number = :part_number
        WHERE id = :id
    ");

    $stmt->bindValue(':customer_number', $customer_number);
    $stmt->bindValue(':customer_name', $customer_name);
    $stmt->bindValue(':part_number', $part_number);
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->execute();

    header("Location: admin.php?tab=graphics&updated=1");
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && !isset($_POST['update_entry']) && !isset($_POST['upload_preview']) && !isset($_POST['access_code']) && !isset($_POST['repair_import_csv']) && !in_array(($_POST['action'] ?? ''), ['add_vendor_art', 'update_vendor_art', 'delete_vendor_art', 'import_existing_approval', 'delete_approval_preview'], true)) {
    $customer_number = trim($_POST['customer_number']);
    $customer_name = trim($_POST['customer_name']);
    $part_number = trim($_POST['part_number']);
    $entry_mode = $_POST['entry_mode'] ?? 'next';
    $manual_g_number = trim($_POST['manual_g_number'] ?? '');

    if ($customer_number && $customer_name && $part_number) {
        if ($entry_mode === 'manual') {
            $cleanManual = strtoupper(str_replace([' ', '#'], '', $manual_g_number));
            $cleanManual = str_replace('G', '', $cleanManual);

            if ($cleanManual === '' || !preg_match('/^\d+$/', $cleanManual)) {
                header("Location: admin.php?tab=graphics&error=" . urlencode("Invalid existing G#. Enter numbers only, like 12856."));
                exit;
            }

            $nextNumber = intval($cleanManual);
            $g_number = 'G#' . $nextNumber;

            $duplicateStmt = $db->prepare("SELECT COUNT(*) FROM graphics WHERE g_number = :g_number");
            $duplicateStmt->bindValue(':g_number', $g_number);
            $exists = intval($duplicateStmt->execute()->fetchArray(SQLITE3_NUM)[0] ?? 0);

            if ($exists > 0) {
                header("Location: admin.php?tab=graphics&error=" . urlencode($g_number . " already exists."));
                exit;
            }
        } else {
            $lastNumber = $db->querySingle("SELECT value FROM settings WHERE key = 'last_g_number'");
            $nextNumber = intval($lastNumber) + 1;
            $g_number = 'G#' . $nextNumber;
        }

        $stmt = $db->prepare("
            INSERT INTO graphics 
            (g_number, customer_number, customer_name, part_number)
            VALUES 
            (:g_number, :customer_number, :customer_name, :part_number)
        ");

        $stmt->bindValue(':g_number', $g_number);
        $stmt->bindValue(':customer_number', $customer_number);
        $stmt->bindValue(':customer_name', $customer_name);
        $stmt->bindValue(':part_number', $part_number);
        $stmt->execute();

        $currentLast = intval($db->querySingle("SELECT value FROM settings WHERE key = 'last_g_number'"));

        if ($nextNumber > $currentLast) {
            $stmtUpdate = $db->prepare("UPDATE settings SET value = :value WHERE key = 'last_g_number'");
            $stmtUpdate->bindValue(':value', $nextNumber);
            $stmtUpdate->execute();
        }

        header("Location: admin.php?tab=graphics&created=" . urlencode($g_number));
        exit;
    }
}


if (isset($_GET['ajax_search']) && $_GET['ajax_search'] === '1') {
    header('Content-Type: application/json');

    $q = trim($_GET['q'] ?? '');

    if ($q !== '') {
        $stmt = $db->prepare("
            SELECT * FROM graphics
            WHERE g_number LIKE :search
            OR customer_number LIKE :search
            OR customer_name LIKE :search
            OR part_number LIKE :search
            ORDER BY CAST(REPLACE(REPLACE(g_number, 'G#', ''), '#', '') AS INTEGER) DESC
        ");
        $stmt->bindValue(':search', '%' . $q . '%');
        $ajaxResults = $stmt->execute();
    } else {
        $ajaxResults = $db->query("
            SELECT * FROM graphics
            ORDER BY CAST(REPLACE(REPLACE(g_number, 'G#', ''), '#', '') AS INTEGER) DESC
            LIMIT 10
        ");
    }

    $rows = [];

    while ($row = $ajaxResults->fetchArray(SQLITE3_ASSOC)) {
        $rows[] = [
            'id' => $row['id'] ?? '',
            'g_number' => $row['g_number'] ?? '',
            'customer_number' => $row['customer_number'] ?? '',
            'customer_name' => $row['customer_name'] ?? '',
            'part_number' => $row['part_number'] ?? '',
            'preview_image' => $row['preview_image'] ?? ''
        ];
    }

    echo json_encode($rows);
    exit;
}

$search = trim($_GET['search'] ?? '');

if ($search) {
    $stmt = $db->prepare("
        SELECT * FROM graphics
        WHERE g_number LIKE :search
        OR customer_number LIKE :search
        OR customer_name LIKE :search
        OR part_number LIKE :search
        ORDER BY CAST(REPLACE(REPLACE(g_number, 'G#', ''), '#', '') AS INTEGER) DESC
    ");
    $stmt->bindValue(':search', '%' . $search . '%');
    $results = $stmt->execute();
} else {
    $results = $db->query("
        SELECT * FROM graphics
        ORDER BY CAST(REPLACE(REPLACE(g_number, 'G#', ''), '#', '') AS INTEGER) DESC
        LIMIT 10
    ");
}


$vendorEditEntry = null;
if (isset($_GET['edit_vendor'])) {
    $vendorEditId = intval($_GET['edit_vendor']);
    $vendorEditStmt = $db->prepare("SELECT * FROM vendor_art WHERE id = :id LIMIT 1");
    $vendorEditStmt->bindValue(':id', $vendorEditId, SQLITE3_INTEGER);
    $vendorEditEntry = $vendorEditStmt->execute()->fetchArray(SQLITE3_ASSOC);
}

$vendorAdminSearch = trim($_GET['vendor_admin_search'] ?? '');
if ($vendorAdminSearch !== '') {
    $vendorAdminStmt = $db->prepare("
        SELECT *
        FROM vendor_art
        WHERE vendor_art_number LIKE :search
           OR vendor_name LIKE :search
           OR vendor_prefix LIKE :search
           OR vendor_raw_number LIKE :search
           OR customer_number LIKE :search
           OR customer_name LIKE :search
           OR part_number LIKE :search
        ORDER BY id DESC
    ");
    $vendorAdminStmt->bindValue(':search', '%' . $vendorAdminSearch . '%');
    $vendorAdminResults = $vendorAdminStmt->execute();
} else {
    $vendorAdminResults = $db->query("
        SELECT *
        FROM vendor_art
        ORDER BY id DESC
        LIMIT 50
    ");
}

?>

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/gm2-base.css?v=<?php echo filemtime('assets/css/gm2-base.css'); ?>">
<link rel="stylesheet" href="assets/css/gm2-admin.css?v=<?php echo filemtime('assets/css/gm2-admin.css'); ?>">
<title>Graphics # Tracker Admin</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">

</head>

<body class="admin-page">
<div class="wrapper">

        <header class="app-header">
        <img class="app-logo" src="SUMTER HC-LOGO-HORIZONTAL-web.png" alt="Logo">
        <h1>Graphics Management System</h1>
        <p class="subtitle">Create, store, and search sequential Graphics numbers.</p>

        <nav class="page-nav" aria-label="Page navigation">
            <a href="index.php">G# List</a>
            <a href="approvals.php?tab=create">Approvals</a>
            <a href="printcard_revisions.php">Print Card Revisions</a>
            <a class="logout-link" href="admin.php?logout=1">Logout</a>
        </nav>
    </header>

    <nav class="admin-tab-nav" aria-label="Admin sections">
        <a class="admin-tab-link <?php echo $adminTabClass('graphics'); ?>" href="admin.php?tab=graphics">
            Graphics Manager <span><?php echo number_format($managementStats['graphics']); ?></span>
        </a>
        <a class="admin-tab-link <?php echo $adminTabClass('vendor'); ?>" href="admin.php?tab=vendor">
            Vendor Art <span><?php echo number_format($managementStats['vendor_art']); ?></span>
        </a>
        <a class="admin-tab-link <?php echo $adminTabClass('tools'); ?>" href="admin.php?tab=tools">
            System Tools
        </a>
    </nav>

    <?php if (isset($_GET['created'])): ?>
        <div class="success">
            Created new Graphics #: <?php echo htmlspecialchars($_GET['created']); ?>
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['error'])): ?>
        <div class="warning">
            <?php echo htmlspecialchars($_GET['error']); ?>
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['updated'])): ?>
        <div class="success">
            Entry updated successfully.
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['uploaded'])): ?>
        <div class="success">
            Preview image uploaded successfully.
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['vendor_added'])): ?>
        <div class="success">
            Vendor approval added: <?php echo htmlspecialchars($_GET['vendor_added']); ?>
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['vendor_updated'])): ?>
        <div class="success">
            Vendor art updated: <?php echo htmlspecialchars($_GET['vendor_updated']); ?>
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['vendor_deleted'])): ?>
        <div class="success">
            Vendor art deleted: <?php echo htmlspecialchars($_GET['vendor_deleted']); ?>
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['vendor_error'])): ?>
        <div class="warning">
            <?php echo htmlspecialchars($_GET['vendor_error']); ?>
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['repair_imported']) && isset($_SESSION['repair_import_summary'])): ?>
        <?php $repairSummary = $_SESSION['repair_import_summary']; unset($_SESSION['repair_import_summary']); ?>
        <div class="<?php echo empty($repairSummary['errors']) ? 'success' : 'warning'; ?>">
            Repair Import Complete:
            <?php echo intval($repairSummary['updated']); ?> updated,
            <?php echo intval($repairSummary['inserted']); ?> inserted,
            <?php echo intval($repairSummary['skipped_invalid']); ?> invalid rows skipped.
            <?php if (!empty($repairSummary['highest_number'])): ?>
                Last G# checked through G#<?php echo intval($repairSummary['highest_number']); ?>.
            <?php endif; ?>
            <?php if (!empty($repairSummary['errors'])): ?>
                <br><?php echo htmlspecialchars(implode(' ', $repairSummary['errors'])); ?>
            <?php endif; ?>
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['approval_imported']) && isset($_SESSION['existing_approval_import_summary'])): ?>
        <?php $approvalImportSummary = $_SESSION['existing_approval_import_summary']; unset($_SESSION['existing_approval_import_summary']); ?>
        <div class="success">
            Imported approval for <?php echo htmlspecialchars($approvalImportSummary['g_number']); ?>.<br>
            Graphics record <?php echo htmlspecialchars($approvalImportSummary['graphic_action']); ?>, <?php echo intval($approvalImportSummary['revision_count']); ?> approval revision(s) created, and current approval attached.
        </div>
    <?php endif; ?>

    <?php if (isset($_GET['approval_import_error']) && isset($_SESSION['existing_approval_import_error'])): ?>
        <?php $approvalImportError = $_SESSION['existing_approval_import_error']; unset($_SESSION['existing_approval_import_error']); ?>
        <div class="warning">
            Approval import failed: <?php echo htmlspecialchars($approvalImportError); ?>
        </div>
    <?php endif; ?>

    <div id="ajaxUploadMessage" class="success is-hidden"></div>

    <?php if ($maintenanceMessage): ?>
        <div class="<?php echo htmlspecialchars($maintenanceMessageType); ?>">
            <?php echo htmlspecialchars($maintenanceMessage); ?>
        </div>
    <?php endif; ?>

    <?php if ($backupMessage): ?>
        <div class="<?php echo htmlspecialchars($backupMessageType); ?>">
            <?php echo htmlspecialchars($backupMessage); ?>
            <?php if ($backupFileName): ?>
                <br>
                <a 
                    href="admin.php?tab=tools&download_backup=<?php echo urlencode($backupFileName); ?>" 
                    class="backup-download-link"
                >
                    Download Backup ZIP
                </a>
            <?php endif; ?>
        </div>
    <?php endif; ?>

    <div class="admin-manager-layout admin-tab-layout">

        <div class="admin-tab-panel <?php echo $adminTab === 'graphics' ? 'active' : ''; ?>" id="admin-tab-graphics">
        <section class="admin-manager-row admin-graphics-manager" aria-label="Graphics manager">
            <div class="admin-manager-sidebar">
                <section class="card gm-card admin-create-card">
            <h2><?php echo $editEntry ? 'Edit G# Entry' : 'Create Graphics #'; ?></h2>
            <p class="muted">
                <?php echo $editEntry ? 'Update the customer or part information. The G# will not change.' : 'Enter all 3 fields to generate the next sequential Graphics number.'; ?>
            </p>

            <form method="POST">
                <?php if (!$editEntry): ?>
                    <label>G# Mode</label>
                    <div class="mode-toggle">
                        <label class="mode-option">
                            <input type="radio" name="entry_mode" value="next" checked onchange="toggleGNumberMode()">
                            <span>Create Next G#</span>
                        </label>
                        <label class="mode-option">
                            <input type="radio" name="entry_mode" value="manual" onchange="toggleGNumberMode()">
                            <span>Add Existing G#</span>
                        </label>
                    </div>

                    <div id="manualGNumberWrap" class="manual-g-wrap">
                        <label>Existing G#</label>
                        <input type="text" name="manual_g_number" id="manualGNumberInput" placeholder="Example: 12856">
                        <p class="muted mt-8">
                            Use this only for missing historical G#s. Duplicates will be blocked automatically.
                        </p>
                    </div>
                <?php endif; ?>

                <?php if ($editEntry): ?>
                    <input type="hidden" name="update_entry" value="1">
                    <input type="hidden" name="id" value="<?php echo $editEntry['id']; ?>">

                    <p class="muted">
                        Editing: <strong class="gnum"><?php echo htmlspecialchars($editEntry['g_number']); ?></strong>
                    </p>
                <?php endif; ?>

                <label>Customer #</label>
                <input 
                    type="text" 
                    name="customer_number" 
                    required
                    class="text-uppercase"
                    value="<?php echo $editEntry ? htmlspecialchars($editEntry['customer_number']) : ''; ?>"
                >

                <label>Customer Name</label>
                <input 
                    type="text" 
                    name="customer_name" 
                    required
                    class="text-uppercase"
                    value="<?php echo $editEntry ? htmlspecialchars($editEntry['customer_name']) : ''; ?>"
                >

                <label>Part #</label>
                <input 
                    type="text" 
                    name="part_number" 
                    required
                    class="text-uppercase"
                    value="<?php echo $editEntry ? htmlspecialchars($editEntry['part_number']) : ''; ?>"
                >

                <button type="submit" id="createSubmitButton">
                    <?php echo $editEntry ? 'Save Changes' : 'Create Graphics #'; ?>
                </button>

                <?php if ($editEntry): ?>
                    <p>
                        <a href="admin.php?tab=graphics" class="muted-link">Cancel edit</a>
                    </p>
                <?php endif; ?>
            </form>

            <?php if (false): ?>
            <?php if (!$editEntry): ?>
                <div class="repair-import-box">
                    <h2 class="repair-heading">Repair Import CSV</h2>
                    <p class="muted">
                        Temporary tool: upload the corrected WebCenter CSV to update existing G# records and insert any missing ones. Previews and print card revisions are preserved.
                    </p>

                    <form method="POST" enctype="multipart/form-data">
                        <input type="hidden" name="repair_import_csv" value="1">

                        <label>Corrected CSV File</label>
                        <input 
                            class="file-upload"
                            type="file" 
                            name="repair_csv_file" 
                            accept=".csv,text/csv"
                            required
                        >

                        <button type="submit">
                            Repair / Update G# Records
                        </button>
                    </form>
                </div>
            <?php endif; ?>
            <?php endif; ?>

                </section>


            </div>

            <div class="admin-manager-main">
                <section class="card gm-card admin-graphics-table-card">
            <div class="admin-card-header-with-stats">
                <div class="admin-card-heading-copy">
                    <div class="gm2-section-kicker">Graphics Database</div>
                    <h2 id="adminResultsHeading"><?php echo $search ? 'Search Results' : 'Latest 10 Graphics Numbers'; ?></h2>
                </div>

                <div class="admin-inline-stats" aria-label="Graphics Manager counts">
                    <div class="admin-inline-stat"><span>G#</span><strong><?php echo number_format($managementStats['graphics']); ?></strong></div>
                    <div class="admin-inline-stat"><span>VEN</span><strong><?php echo number_format($managementStats['vendor_art']); ?></strong></div>
                    <div class="admin-inline-stat"><span>APR</span><strong><?php echo number_format($managementStats['approvals']); ?></strong></div>
                    <div class="admin-inline-stat"><span>PC</span><strong><?php echo number_format($managementStats['print_cards']); ?></strong></div>
                </div>
            </div>

            <div class="admin-action-row">

                <a href="export_csv.php" class="action-btn">
                    Export CSV
                </a>

                <button type="button" class="action-btn button-reset" onclick="printDisplayedAdminReport()">
                    Print Displayed Results
                </button>

            </div>

            <form method="GET" class="search-form" id="adminSearchForm">
                <input type="hidden" name="tab" value="graphics">
                <input 
                    type="text" 
                    name="search" 
                    id="adminLiveSearch"
                    placeholder="Live search G#, Customer #, Customer Name, or Part #"
                    value="<?php echo htmlspecialchars($search); ?>"
                    autocomplete="off"
                >
                <button type="submit">Search</button>
            </form>

            <?php if ($search): ?>
                <p class="muted">
                    Showing results for: <strong><?php echo htmlspecialchars($search); ?></strong>
                    | <a href="admin.php?tab=graphics" class="clear-search-link">Clear Search</a>
                </p>
            <?php endif; ?>

            <div class="gm-table-wrap">
            <table id="adminGraphicsTable" class="gm-table">
                <thead>
                <tr>
                    <th>G#</th>
                    <th>Customer #</th>
                    <th>Customer Name</th>
                    <th>Part #</th>
                    <th>Edit</th>
                    <th>Upload</th>
                    <th>Preview</th>
                </tr>
                </thead>
                <tbody id="adminGraphicsTableBody">

                <?php while ($row = $results->fetchArray(SQLITE3_ASSOC)): ?>
                <tr class="graphics-data-row">
                    <td class="gnum"><?php echo htmlspecialchars($row['g_number']); ?></td>
                    <td><?php echo htmlspecialchars($row['customer_number']); ?></td>
                    <td><?php echo htmlspecialchars($row['customer_name']); ?></td>
                    <td><?php echo htmlspecialchars($row['part_number']); ?></td>
                    <td>
                        <a class="gm2-icon-action" title="Edit Graphics #" href="admin.php?tab=graphics&edit=<?php echo $row['id']; ?>">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"></path><path d="m14 6 4 4"></path></svg><span class="sr-only">Edit</span>
                        </a>
                    </td>
                    <td>
                        <form method="POST" enctype="multipart/form-data" class="icon-form">
                            <input type="hidden" name="upload_preview" value="1">
                            <input type="hidden" name="ajax_upload" value="1">
                            <input type="hidden" name="id" value="<?php echo $row['id']; ?>">

                            <label class="icon-btn" title="Upload Preview">
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path><path d="M5 21h14"></path></svg><span class="sr-only">Upload</span>
                                <input 
                                    class="file-input"
                                    type="file" 
                                    name="preview_image" 
                                    accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
                                    onchange="handlePreviewUpload(this)"
                                >
                            </label>
                        </form>
                    </td>
                    <td>
                        <?php if (!empty($row['preview_image'])): ?>
                            <button 
                                type="button" 
                                class="icon-btn"
                                title="View Preview"
                                onclick="openPreview('<?php echo htmlspecialchars($row['preview_image'], ENT_QUOTES); ?>', '<?php echo intval($row['id']); ?>')"
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="3"></circle></svg><span class="sr-only">View</span>
                            </button>

                            <button 
                                type="button" 
                                class="icon-btn delete-preview-btn"
                                title="Remove Preview + Delete File"
                                onclick="deleteApprovalPreview('<?php echo intval($row['id']); ?>')"
                            >
                                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 14h10l1-14"></path><path d="M9 7V4h6v3"></path></svg><span class="sr-only">Delete</span>
                            </button>
                        <?php endif; ?>
                    </td>
                </tr>
                <?php endwhile; ?>
                </tbody>
            </table>
            </div>
                </section>


            </div>
        </section>
        </div>

        <div class="admin-tab-panel <?php echo $adminTab === 'vendor' ? 'active' : ''; ?>" id="admin-tab-vendor">
        <section class="admin-manager-row admin-vendor-manager" aria-label="Vendor art manager">
            <div class="admin-manager-sidebar">
                <section class="card gm-card admin-vendor-form-card">
            <h2><?php echo $vendorEditEntry ? 'Edit Vendor Art' : 'Add Vendor Approval'; ?></h2>
            <p class="muted">
                <?php echo $vendorEditEntry ? 'Update the vendor art record. Replacing the PDF is optional.' : 'Select the vendor and upload their approval PDF. Vendor Art #, customer info, and part/item description will be pulled from the PDF fields automatically.'; ?>
            </p>

            <form method="POST" enctype="multipart/form-data" class="vendor-admin-grid">
                <input type="hidden" name="action" value="<?php echo $vendorEditEntry ? 'update_vendor_art' : 'add_vendor_art'; ?>">
                <?php if ($vendorEditEntry): ?>
                    <input type="hidden" name="vendor_id" value="<?php echo intval($vendorEditEntry['id']); ?>">
                <?php endif; ?>

                <label>Vendor</label>
                <select name="vendor_name" required>
                    <option value="">Select Vendor</option>
                    <?php foreach (getVendorOptions() as $vendorName => $vendorPrefix): ?>
                        <option value="<?php echo htmlspecialchars($vendorName); ?>" <?php echo ($vendorEditEntry && ($vendorEditEntry['vendor_name'] ?? '') === $vendorName) ? 'selected' : ''; ?>>
                            <?php echo htmlspecialchars($vendorName . ' = ' . $vendorPrefix . '#'); ?>
                        </option>
                    <?php endforeach; ?>
                </select>

                <?php if ($vendorEditEntry): ?>
                    <label>Vendor Art # / Vendor Number</label>
                    <input name="vendor_raw_number" class="uppercase-input" value="<?php echo htmlspecialchars($vendorEditEntry['vendor_raw_number']); ?>" placeholder="Vendor number from approval PDF">
                <?php endif; ?>

                <label>Vendor Approval PDF</label>
                <input type="file" name="vendor_approval_pdf" accept="application/pdf,.pdf" <?php echo $vendorEditEntry ? '' : 'required'; ?>>
                <?php if ($vendorEditEntry && !empty($vendorEditEntry['preview_image'])): ?>
                    <p class="muted mt-8">Current PDF: <strong><?php echo htmlspecialchars($vendorEditEntry['preview_image']); ?></strong></p>
                <?php endif; ?>

                <?php if ($vendorEditEntry): ?>
                    <label>Customer #</label>
                    <input name="vendor_customer_number" class="uppercase-input" value="<?php echo htmlspecialchars($vendorEditEntry['customer_number']); ?>">

                    <label>Customer Name</label>
                    <input name="vendor_customer_name" class="uppercase-input" value="<?php echo htmlspecialchars($vendorEditEntry['customer_name']); ?>">

                    <label>Part / Item Description</label>
                    <input name="vendor_part_number" class="uppercase-input" value="<?php echo htmlspecialchars($vendorEditEntry['part_number']); ?>">
                <?php else: ?>
                    <p class="muted mt-10">Customer info, Part #, and Vendor Art # will be read from the uploaded approval PDF.</p>
                <?php endif; ?>

                <button type="submit"><?php echo $vendorEditEntry ? 'Save Vendor Art' : 'Add Vendor Approval'; ?></button>

                <?php if ($vendorEditEntry): ?>
                    <p><a href="admin.php?tab=vendor" class="muted-link">Cancel vendor edit</a></p>
                <?php endif; ?>
            </form>
                </section>


            </div>

            <div class="admin-manager-main">
                <section class="card gm-card admin-vendor-table-card">
            <div class="gm2-section-kicker">Vendor Art Database</div>
            <h2>Vendor Art Management</h2>
            <p class="muted">Edit, view, replace, or delete vendor approval records. Print cards and print card revisions are not deleted from here.</p>

            <form method="GET" class="search-form">
                <input type="hidden" name="tab" value="vendor">
                <input
                    type="text"
                    name="vendor_admin_search"
                    placeholder="Search Vendor Art #, vendor, customer, or part #"
                    value="<?php echo htmlspecialchars($vendorAdminSearch); ?>"
                    autocomplete="off"
                >
                <button type="submit">Search Vendor Art</button>
            </form>

            <?php if ($vendorAdminSearch): ?>
                <p class="muted">
                    Showing vendor results for: <strong><?php echo htmlspecialchars($vendorAdminSearch); ?></strong>
                    | <a href="admin.php?tab=vendor" class="clear-search-link">Clear Search</a>
                </p>
            <?php endif; ?>

            <div class="gm-table-wrap">
            <table id="adminVendorArtTable" class="gm-table">
                <thead>
                <tr>
                    <th>Vendor Art #</th>
                    <th>Vendor</th>
                    <th>Customer #</th>
                    <th>Customer Name</th>
                    <th>Part #</th>
                    <th>Edit</th>
                    <th>Preview</th>
                </tr>
                </thead>
                <tbody>
                <?php while ($vendorRow = $vendorAdminResults->fetchArray(SQLITE3_ASSOC)): ?>
                <?php $vendorPreview = safePath($vendorRow['preview_image'] ?? ''); ?>
                <tr>
                    <td class="gnum"><?php echo htmlspecialchars($vendorRow['vendor_art_number']); ?></td>
                    <td><?php echo htmlspecialchars($vendorRow['vendor_name']); ?></td>
                    <td><?php echo htmlspecialchars($vendorRow['customer_number']); ?></td>
                    <td><?php echo htmlspecialchars($vendorRow['customer_name']); ?></td>
                    <td><?php echo htmlspecialchars($vendorRow['part_number']); ?></td>
                    <td>
                        <a class="gm2-icon-action" title="Edit Vendor Record" href="admin.php?tab=vendor&edit_vendor=<?php echo intval($vendorRow['id']); ?>">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"></path><path d="m14 6 4 4"></path></svg><span class="sr-only">Edit</span>
                        </a>
                    </td>
                    <td>
                        <div class="vendor-preview-actions">
                            <?php if ($vendorPreview): ?>
                                <button
                                    type="button"
                                    class="icon-btn"
                                    title="View Vendor Approval"
                                    onclick="openPreview('<?php echo htmlspecialchars($vendorPreview, ENT_QUOTES); ?>', '')"
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="3"></circle></svg><span class="sr-only">View</span>
                                </button>
                            <?php endif; ?>

                            <form method="POST" onsubmit="return confirm('Delete this entire vendor art record and its approval PDF? Print cards and print card revisions will NOT be deleted.');">
                                <input type="hidden" name="action" value="delete_vendor_art">
                                <input type="hidden" name="vendor_id" value="<?php echo intval($vendorRow['id']); ?>">
                                <button
                                    type="submit"
                                    class="icon-btn delete-preview-btn"
                                    title="Delete Vendor Record"
                                >
                                    <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 14h10l1-14"></path><path d="M9 7V4h6v3"></path></svg><span class="sr-only">Delete</span>
                                </button>
                            </form>
                        </div>
                    </td>
                </tr>
                <?php endwhile; ?>
                </tbody>
            </table>
            </div>
                </section>
            </div>
        </section>
        </div>

        <div class="admin-tab-panel <?php echo $adminTab === 'tools' ? 'active' : ''; ?>" id="admin-tab-tools">
        <section class="admin-system-row admin-import-approval-row" aria-label="Import existing approval">
            <section class="card gm-card admin-import-approval-card">
                <div class="admin-import-approval-copy">
                    <div class="gm2-section-kicker">Approval Import</div>
                    <h2>Import Existing Approval</h2>
                    <p class="muted">
                        Upload a completed approval PDF. GM2 will read the form fields, create the G# record, attach the current approval, and build the approval revision history automatically.
                    </p>
                </div>

                <form method="POST" enctype="multipart/form-data" class="admin-import-approval-form" onsubmit="return confirm('Import this approval PDF and create its approval revision history?');">
                    <input type="hidden" name="action" value="import_existing_approval">

                    <label>Approval PDF</label>
                    <input type="file" name="existing_approval_pdf" accept="application/pdf,.pdf" required>

                    <p class="muted mt-8">
                        ART # will be stripped down to the base G# automatically. Example: <strong>11617-3</strong> imports as <strong>G#11617</strong> with Rev 3 as the current approval.
                    </p>

                    <button type="submit">Import Approval + Revisions</button>
                </form>
            </section>
        </section>

        <section class="admin-system-row admin-health-row" aria-label="Database health report">
            <section class="card gm-card admin-health-card">
                <div class="admin-health-copy">
                    <div class="gm2-section-kicker">Database Maintenance</div>
                    <h2>Database Health Report</h2>
                    <p class="muted">
                        Checks for missing approval PDF links, orphan approval files, orphan revision rows, and missing PDF paths before the TypeScript migration.
                    </p>
                </div>

                <div class="mini-dashboard admin-health-stats">
                    <div class="mini-stat">
                        <span class="mini-label">Graphics</span>
                        <span class="mini-value"><?php echo number_format($databaseHealthReport['graphics']); ?></span>
                    </div>
                    <div class="mini-stat">
                        <span class="mini-label">Approvals</span>
                        <span class="mini-value"><?php echo number_format($databaseHealthReport['approvals']); ?></span>
                    </div>
                    <div class="mini-stat">
                        <span class="mini-label">Approval Revisions</span>
                        <span class="mini-value"><?php echo number_format($databaseHealthReport['approval_revisions']); ?></span>
                    </div>
                    <div class="mini-stat">
                        <span class="mini-label">Print Cards</span>
                        <span class="mini-value"><?php echo number_format($databaseHealthReport['print_cards']); ?></span>
                    </div>
                    <div class="mini-stat">
                        <span class="mini-label">Repairable Links</span>
                        <span class="mini-value"><?php echo count($databaseHealthReport['repairable_approval_links']); ?></span>
                    </div>
                    <div class="mini-stat">
                        <span class="mini-label">Missing Preview PDFs</span>
                        <span class="mini-value"><?php echo count($databaseHealthReport['missing_graphic_preview_files']); ?></span>
                    </div>
                    <div class="mini-stat">
                        <span class="mini-label">Missing Revision PDFs</span>
                        <span class="mini-value"><?php echo count($databaseHealthReport['missing_revision_pdf_files']); ?></span>
                    </div>
                    <div class="mini-stat">
                        <span class="mini-label">Orphan Files</span>
                        <span class="mini-value"><?php echo count($databaseHealthReport['orphan_approval_files']); ?></span>
                    </div>
                </div>

                <div class="admin-health-action">
                    <form method="POST" action="admin.php?tab=tools" onsubmit="return confirm('Repair missing approval preview links and current approval revision PDF links where matching approval PDFs already exist?');">
                        <input type="hidden" name="action" value="repair_approval_links">
                        <button type="submit">Repair Approval Links</button>
                    </form>
                </div>

                <?php
                    $healthIssues = [
                        'Repairable approval links' => $databaseHealthReport['repairable_approval_links'],
                        'Missing Graphics preview PDF files' => $databaseHealthReport['missing_graphic_preview_files'],
                        'Missing Approval Revision PDF files' => $databaseHealthReport['missing_revision_pdf_files'],
                        'Orphan approval files' => $databaseHealthReport['orphan_approval_files'],
                        'Orphan approval revision rows' => $databaseHealthReport['orphan_revision_rows']
                    ];
                ?>

                <div class="admin-health-details">
                    <?php foreach ($healthIssues as $healthLabel => $healthRows): ?>
                        <details class="admin-health-detail" <?php echo count($healthRows) ? '' : ''; ?>>
                            <summary><?php echo htmlspecialchars($healthLabel); ?> <span><?php echo count($healthRows); ?></span></summary>
                            <?php if (empty($healthRows)): ?>
                                <p class="muted">No issues found.</p>
                            <?php else: ?>
                                <ul>
                                    <?php foreach (array_slice($healthRows, 0, 12) as $healthRow): ?>
                                        <li>
                                            <?php if (is_array($healthRow)): ?>
                                                <?php echo htmlspecialchars(trim(($healthRow['g_number'] ?? '') . ' ' . ($healthRow['path'] ?? '') . (!empty($healthRow['id']) ? ' Row ID: ' . $healthRow['id'] : ''))); ?>
                                            <?php else: ?>
                                                <?php echo htmlspecialchars($healthRow); ?>
                                            <?php endif; ?>
                                        </li>
                                    <?php endforeach; ?>
                                </ul>
                                <?php if (count($healthRows) > 12): ?>
                                    <p class="muted">Showing first 12 of <?php echo count($healthRows); ?>.</p>
                                <?php endif; ?>
                            <?php endif; ?>
                        </details>
                    <?php endforeach; ?>
                </div>
            </section>
        </section>

        <section class="admin-system-row" aria-label="System manager">
            <section class="card backup-card admin-system-card">
            <div class="admin-system-copy">
                <div class="gm2-section-kicker">System Manager</div>
                <h2>Create Manual Backup</h2>
                <p class="muted">
                    Creates a timestamped ZIP backup and saves it to <strong>backup_temp</strong>.
                </p>
            </div>

            <div class="mini-dashboard admin-system-stats">
                <div class="mini-stat">
                    <span class="mini-label">Last Backup</span>
                    <span class="mini-value"><?php echo $backupStats['latest_time'] ? date('n/j/y g:i A', $backupStats['latest_time']) : 'None Yet'; ?></span>
                </div>
                <div class="mini-stat">
                    <span class="mini-label">Newest Size</span>
                    <span class="mini-value"><?php echo $backupStats['latest_size'] ? formatBytesForAdmin($backupStats['latest_size']) : '—'; ?></span>
                </div>
                <div class="mini-stat">
                    <span class="mini-label">Backup Count</span>
                    <span class="mini-value"><?php echo intval($backupStats['count']); ?></span>
                </div>
                <div class="mini-stat">
                    <span class="mini-label">Total Stored</span>
                    <span class="mini-value"><?php echo formatBytesForAdmin($backupStats['total_size']); ?></span>
                </div>
            </div>

            <div class="admin-system-action">
                <?php if ($backupStats['latest_name']): ?>
                    <p class="muted latest-backup">
                        Newest: <strong><?php echo htmlspecialchars($backupStats['latest_name']); ?></strong>
                    </p>
                <?php endif; ?>

                <form method="POST" action="admin.php?tab=tools" onsubmit="return confirm('Create a full backup of the Graphics Management Tool?');">
                    <button type="submit" name="create_backup" value="1">
                        Create Full Backup
                    </button>
                </form>
            </div>
            </section>
        </section>
        </div>

    </div>
</div>

<div id="previewModal" class="preview-modal" data-current-id="" data-current-src="" onclick="closePreview()">
    <div class="preview-box" onclick="event.stopPropagation()">
        <button type="button" class="close-preview" onclick="closePreview()">×</button>

        <img id="previewImage" src="" class="preview-image is-hidden" alt="Graphics Preview">

        <iframe id="previewPDF" class="preview-pdf is-hidden"></iframe>

        <a
            id="openApprovalPdfBtn"
            class="button-link secondary gm-btn gm-btn-secondary is-hidden"
            href="#"
            target="_blank"
            rel="noopener"
            style="margin-top:12px;"
        >
            Open PDF
        </a>

        <button 
            type="button" 
            id="deleteApprovalPreviewBtn"
            class="preview-delete-btn is-hidden"
            onclick="deleteCurrentApprovalPreview()"
        >
            Remove Preview + Delete File
        </button>

    </div>
</div>

<script>

const adminSearchForm = document.getElementById('adminSearchForm');
const adminLiveSearch = document.getElementById('adminLiveSearch');
let adminSearchTimer = null;

function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function escapeJs(value) {
    return String(value ?? '')
        .replace(/\\/g, '\\\\')
        .replace(/'/g, "\\'")
        .replace(/"/g, '&quot;')
        .replace(/\n/g, ' ')
        .replace(/\r/g, ' ');
}

function renderAdminRows(rows) {
    const tbody = document.getElementById('adminGraphicsTableBody');
    const heading = document.getElementById('adminResultsHeading');

    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = `
            <tr class="no-results-row">
                <td colspan="7" class="muted">No matching Graphics numbers found.</td>
            </tr>
        `;
        if (heading) heading.textContent = 'Latest 10 Graphics Numbers';
        return;
    }

    tbody.innerHTML = rows.map(row => {
        const preview = row.preview_image || '';

        const previewButton = preview ? `
            <button 
                type="button" 
                class="icon-btn"
                title="View Preview"
                onclick="openPreview('${escapeJs(preview)}', '${escapeJs(row.id)}')"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="3"></circle></svg><span class="sr-only">View</span>
            </button>
            <button
                type="button"
                class="icon-btn delete-preview-btn"
                title="Remove Preview + Delete File"
                onclick="deleteApprovalPreview('${escapeJs(row.id)}')"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16"></path><path d="M10 11v6"></path><path d="M14 11v6"></path><path d="M6 7l1 14h10l1-14"></path><path d="M9 7V4h6v3"></path></svg><span class="sr-only">Delete</span>
            </button>
        ` : '';

        return `
            <tr class="graphics-data-row">
                <td class="gnum">${escapeHtml(row.g_number)}</td>
                <td>${escapeHtml(row.customer_number)}</td>
                <td>${escapeHtml(row.customer_name)}</td>
                <td>${escapeHtml(row.part_number)}</td>
                <td>
                    <a class="gm2-icon-action" title="Edit Graphics #" href="admin.php?edit=${encodeURIComponent(row.id)}">
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M4 20h4l11-11a2.8 2.8 0 0 0-4-4L4 16v4Z"></path><path d="m14 6 4 4"></path></svg><span class="sr-only">Edit</span>
                    </a>
                </td>
                <td>
                    <form method="POST" enctype="multipart/form-data" class="icon-form">
                        <input type="hidden" name="upload_preview" value="1">
                        <input type="hidden" name="ajax_upload" value="1">
                        <input type="hidden" name="id" value="${escapeHtml(row.id)}">

                        <label class="icon-btn" title="Upload Preview">
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M12 19V5"></path><path d="m5 12 7-7 7 7"></path><path d="M5 21h14"></path></svg><span class="sr-only">Upload</span>
                            <input 
                                class="file-input"
                                type="file" 
                                name="preview_image" 
                                accept="image/jpeg,image/png,image/webp,application/pdf,.pdf"
                                onchange="handlePreviewUpload(this)"
                            >
                        </label>
                    </form>
                </td>
                <td>${previewButton}</td>
            </tr>
        `;
    }).join('');

    if (heading) heading.textContent = 'Latest 10 Graphics Numbers';
}

function liveSearchAdminGraphics() {
    const q = adminLiveSearch ? adminLiveSearch.value : '';

    fetch('admin.php?ajax_search=1&q=' + encodeURIComponent(q), {
        cache: 'no-store'
    })
    .then(response => response.json())
    .then(rows => renderAdminRows(rows))
    .catch(error => {
        console.error('Admin live search error:', error);
    });
}

if (adminSearchForm) {
    adminSearchForm.addEventListener('submit', function(event) {
        event.preventDefault();
        liveSearchAdminGraphics();
    });
}

if (adminLiveSearch) {
    adminLiveSearch.addEventListener('input', function() {
        clearTimeout(adminSearchTimer);
        adminSearchTimer = setTimeout(liveSearchAdminGraphics, 150);
    });
}

function printDisplayedAdminReport() {
    const rows = Array.from(document.querySelectorAll('#adminGraphicsTableBody tr'))
        .filter(row => !row.classList.contains('no-results-row'));

    const searchText = adminLiveSearch ? adminLiveSearch.value.trim() : '';

    let bodyRows = rows.map(row => {
        const cells = row.querySelectorAll('td');
        return `
            <tr>
                <td>${cells[0] ? cells[0].innerText : ''}</td>
                <td>${cells[1] ? cells[1].innerText : ''}</td>
                <td>${cells[2] ? cells[2].innerText : ''}</td>
                <td>${cells[3] ? cells[3].innerText : ''}</td>
            </tr>
        `;
    }).join('');

    if (!bodyRows) {
        bodyRows = '<tr><td colspan="4">No displayed results to print.</td></tr>';
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Graphics Report</title>
            <style>
                body {
                    font-family: Arial, Helvetica, sans-serif;
                    color: #111;
                    background: #fff;
                    padding: 24px;
                    margin: 0;
                }
                h1 {
                    margin: 0 0 6px;
                    font-size: 24px;
                    font-weight: 800;
                    color: #111;
                }
                p {
                    margin: 0 0 18px;
                    color: #555;
                    font-size: 14px;
                }
                table {
                    width: 100%;
                    border-collapse: collapse;
                    table-layout: fixed;
                }
                th, td {
                    border: 1px solid #999;
                    padding: 8px;
                    font-size: 12px;
                    text-align: left;
                    color: #111;
                    white-space: normal;
                    word-break: break-word;
                }
                th {
                    background: #eee;
                    font-weight: 800;
                }
                th:nth-child(1), td:nth-child(1) { width: 14%; }
                th:nth-child(2), td:nth-child(2) { width: 18%; }
                th:nth-child(3), td:nth-child(3) { width: 32%; }
                th:nth-child(4), td:nth-child(4) { width: 36%; }
            </style>
        </head>
        <body class="print-report">
            <h1>Graphics Report</h1>
            <p>${searchText ? 'Displayed search results for: ' + escapeHtml(searchText) : 'All displayed results'}</p>
            <table>
                <thead>
                    <tr>
                        <th>G#</th>
                        <th>Customer #</th>
                        <th>Customer Name</th>
                        <th>Part #</th>
                    </tr>
                </thead>
                <tbody>${bodyRows}</tbody>
            </table>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}



function showAjaxUploadMessage(message, isSuccess = true) {
    const box = document.getElementById('ajaxUploadMessage');

    if (!box) return;

    box.textContent = message || '';
    box.className = isSuccess ? 'success' : 'warning';
    box.style.display = 'block';

    clearTimeout(window.ajaxUploadMessageTimer);
    window.ajaxUploadMessageTimer = setTimeout(() => {
        box.style.display = 'none';
    }, 3500);
}

function handlePreviewUpload(input) {
    if (!input || !input.files || !input.files.length) return;

    const form = input.closest('form');

    if (!form) return;

    const buttonLabel = form.querySelector('.icon-btn');
    const originalText = buttonLabel ? buttonLabel.firstChild.textContent : '↑';

    if (buttonLabel) {
        buttonLabel.firstChild.textContent = '…';
        buttonLabel.style.opacity = '0.7';
        buttonLabel.style.pointerEvents = 'none';
    }

    const formData = new FormData(form);
    formData.set('ajax_upload', '1');

    fetch('admin.php', {
        method: 'POST',
        body: formData,
        cache: 'no-store'
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            throw new Error(data.message || 'Upload failed.');
        }

        showAjaxUploadMessage(data.message || 'Preview image uploaded successfully.', true);
        liveSearchAdminGraphics();
    })
    .catch(error => {
        console.error('Preview upload error:', error);
        showAjaxUploadMessage(error.message || 'Upload failed.', false);
    })
    .finally(() => {
        input.value = '';

        if (buttonLabel) {
            buttonLabel.firstChild.textContent = originalText || '↑';
            buttonLabel.style.opacity = '';
            buttonLabel.style.pointerEvents = '';
        }
    });
}



function deleteApprovalPreview(id) {
    if (!id) {
        alert('Could not determine which record this approval belongs to.');
        return;
    }

    if (!confirm('Remove this preview and delete the file?')) {
        return;
    }

    const formData = new FormData();
    formData.set('action', 'delete_approval_preview');
    formData.set('id', id);

    fetch('admin.php', {
        method: 'POST',
        body: formData,
        cache: 'no-store'
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            throw new Error(data.message || 'Could not delete preview.');
        }

        closePreview();
        showAjaxUploadMessage(data.message || 'Preview removed.', true);

        const deleteButton = document.querySelector(`.delete-preview-btn[onclick*="'${id}'"], .delete-preview-btn[onclick*="(${id})"]`);
        const actionCell = deleteButton ? deleteButton.closest('td') : null;
        if (actionCell) {
            actionCell.innerHTML = '';
        }

        liveSearchAdminGraphics();
    })
    .catch(error => {
        console.error('Delete preview error:', error);
        showAjaxUploadMessage(error.message || 'Could not delete preview.', false);
    });
}

function deleteCurrentApprovalPreview() {
    const modal = document.getElementById('previewModal');
    const id = modal ? (modal.dataset.currentId || '') : '';
    deleteApprovalPreview(id);
}


function toggleGNumberMode() {
    const selected = document.querySelector('input[name="entry_mode"]:checked');
    const manualWrap = document.getElementById('manualGNumberWrap');
    const manualInput = document.getElementById('manualGNumberInput');
    const submitButton = document.getElementById('createSubmitButton');

    const isManual = selected && selected.value === 'manual';

    if (manualWrap) {
        manualWrap.classList.toggle('active', isManual);
    }

    if (manualInput) {
        manualInput.required = isManual;
    }

    if (submitButton && !document.querySelector('input[name="update_entry"]')) {
        submitButton.textContent = isManual ? 'Add Existing G#' : 'Create Graphics #';
    }
}

document.addEventListener('DOMContentLoaded', toggleGNumberMode);

function openPreview(src, id = '') {
    const img = document.getElementById('previewImage');
    const pdf = document.getElementById('previewPDF');
    const modal = document.getElementById('previewModal');
    const deleteBtn = document.getElementById('deleteApprovalPreviewBtn');

    if (!img || !pdf || !modal) {
        return;
    }

    const cleanSrc = String(src || '');
    const isPdf = cleanSrc.toLowerCase().split('?')[0].endsWith('.pdf');

    img.classList.add('is-hidden');
    pdf.classList.add('is-hidden');
    img.removeAttribute('src');
    pdf.removeAttribute('src');

    const openPdfBtn = document.getElementById('openApprovalPdfBtn');

    if (isPdf) {
        pdf.src = cleanSrc;
        img.src = 'admin.php?gm2_pdf_preview=1&file=' + encodeURIComponent(cleanSrc) + '&v=' + Date.now();
        img.classList.remove('is-hidden');
        pdf.classList.add('is-hidden');
        if (openPdfBtn) {
            openPdfBtn.href = cleanSrc;
            openPdfBtn.classList.remove('is-hidden');
        }
    } else {
        img.src = cleanSrc;
        img.classList.remove('is-hidden');
        if (openPdfBtn) {
            openPdfBtn.href = '#';
            openPdfBtn.classList.add('is-hidden');
        }
    }

    modal.dataset.currentId = id || '';
    modal.dataset.currentSrc = cleanSrc || '';

    if (deleteBtn) {
        if (cleanSrc && id) {
            deleteBtn.classList.remove('is-hidden');
        } else {
            deleteBtn.classList.add('is-hidden');
        }
    }

    modal.classList.add('active');
}

function closePreview() {
    const modal = document.getElementById('previewModal');
    const img = document.getElementById('previewImage');
    const pdf = document.getElementById('previewPDF');
    const deleteBtn = document.getElementById('deleteApprovalPreviewBtn');

    if (modal) {
        modal.classList.remove('active');
        modal.dataset.currentId = '';
        modal.dataset.currentSrc = '';
    }

    if (img) {
        img.classList.add('is-hidden');
        img.removeAttribute('src');
    }

    if (pdf) {
        pdf.classList.add('is-hidden');
        pdf.removeAttribute('src');
    }

    const openPdfBtn = document.getElementById('openApprovalPdfBtn');
    if (openPdfBtn) {
        openPdfBtn.href = '#';
        openPdfBtn.classList.add('is-hidden');
    }

    if (deleteBtn) {
        deleteBtn.classList.add('is-hidden');
    }
}
</script>
</div>
</body>
</html>