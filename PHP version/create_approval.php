<?php
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

$db = new SQLite3('graphics.db');

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

$db->exec("
CREATE TABLE IF NOT EXISTS print_card_revisions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    g_number TEXT NOT NULL,
    f_number TEXT NOT NULL,
    d_number TEXT,
    rev TEXT,
    rev_date TEXT,
    description TEXT,
    csr TEXT,
    des TEXT,
    created_at DATETIME DEFAULT CURRENT_TIMESTAMP
)
");

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

// Safety migration for older/incomplete approval_revisions tables.
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
    'd_number' => 'TEXT',
    'customer_number' => 'TEXT',
    'customer_name' => 'TEXT',
    'spec_number' => 'TEXT',
    'item_description' => 'TEXT',
    'test_flute' => 'TEXT',
    'sales_rep' => 'TEXT',
    'approval_date' => 'TEXT',
    'digital_print' => 'TEXT',
    'digital_cut' => 'TEXT',
    'digital_die_cut' => 'TEXT',
    'label_die_cut' => 'TEXT',
    'label_4c_process' => 'TEXT',
    'approval_pdf' => 'TEXT',
    'snapshot_image' => 'TEXT'
];

foreach ($approvalRevisionNeededColumns as $colName => $colType) {
    if (!in_array($colName, $approvalRevisionColumns, true)) {
        $db->exec("ALTER TABLE approval_revisions ADD COLUMN " . $colName . " " . $colType);
    }
}

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

$message = '';
$messageType = 'success';
$selectedGraphic = null;
$createdApprovalWeb = '';

function cleanNumberOnly($value) {
    return preg_replace('/[^0-9]/', '', $value ?? '');
}

function cleanAlphaNumber($value) {
    return strtoupper(preg_replace('/[^A-Z0-9]/i', '', $value ?? ''));
}

function forceUpperText($value) {
    return strtoupper(trim($value ?? ''));
}


function gm2DownloadFileResponse($rawPath, $downloadName = '') {
    $path = trim((string)$rawPath);
    $path = str_replace('\\', '/', $path);
    $path = str_replace(['../', '..\\'], '', $path);
    $path = ltrim($path, '/');

    $allowedFolders = [
        'approvals/',
        'approval_revisions_pdfs/',
        'approval_snapshots/',
        'print_cards/',
        'vendor_approvals/'
    ];

    $allowed = false;
    foreach ($allowedFolders as $folder) {
        if (strpos($path, $folder) === 0) {
            $allowed = true;
            break;
        }
    }

    if (!$allowed) {
        http_response_code(400);
        exit('Invalid download path.');
    }

    $fullPath = __DIR__ . '/' . $path;
    if (!is_file($fullPath)) {
        http_response_code(404);
        exit('File not found.');
    }

    $extension = strtolower(pathinfo($fullPath, PATHINFO_EXTENSION));
    $contentTypes = [
        'pdf' => 'application/pdf',
        'jpg' => 'image/jpeg',
        'jpeg' => 'image/jpeg',
        'png' => 'image/png',
        'webp' => 'image/webp'
    ];

    $contentType = $contentTypes[$extension] ?? 'application/octet-stream';
    $downloadName = trim((string)$downloadName);
    if ($downloadName === '') {
        $downloadName = basename($fullPath);
    }

    $downloadName = preg_replace('/[^A-Za-z0-9._#-]/', '_', $downloadName);
    if ($downloadName === '') {
        $downloadName = basename($fullPath);
    }

    if (ob_get_level()) {
        while (ob_get_level()) {
            ob_end_clean();
        }
    }

    header('Content-Type: ' . $contentType);
    header('Content-Length: ' . filesize($fullPath));
    header('Content-Disposition: attachment; filename="' . $downloadName . '"');
    header('X-Content-Type-Options: nosniff');
    header('Cache-Control: private, max-age=0, must-revalidate');
    header('Pragma: public');

    readfile($fullPath);
    exit;
}

if (isset($_GET['gm2_download']) && $_GET['gm2_download'] === '1') {
    gm2DownloadFileResponse($_GET['file'] ?? '', $_GET['name'] ?? '');
}





function gm2PreviewSafePath($path) {
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
function findPdftkBinary() {
    $candidates = [
        '/opt/homebrew/bin/pdftk',
        '/usr/local/bin/pdftk',
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

function fdfEscape($value) {
    $value = (string)$value;
    $value = str_replace('\\', '\\\\', $value);
    $value = str_replace('(', '\\(', $value);
    $value = str_replace(')', '\\)', $value);
    $value = str_replace(["\r\n", "\r", "\n"], '\\r', $value);
    return $value;
}

function writeApprovalFdf($fields, $checkboxes, $fdfPath) {
    $fdf = "%FDF-1.2\n";
    $fdf .= "1 0 obj\n";
    $fdf .= "<<\n";
    $fdf .= "/FDF << /Fields [\n";

    foreach ($fields as $fieldName => $fieldValue) {
        $fdf .= "<< /T (" . fdfEscape($fieldName) . ") /V (" . fdfEscape($fieldValue) . ") >>\n";
    }

    foreach ($checkboxes as $fieldName => $checked) {
        if ($checked) {
            $fdf .= "<< /T (" . fdfEscape($fieldName) . ") /V /Yes >>\n";
        }
    }

    $fdf .= "] >>\n";
    $fdf .= ">>\n";
    $fdf .= "endobj\n";
    $fdf .= "trailer\n";
    $fdf .= "<< /Root 1 0 R >>\n";
    $fdf .= "%%EOF\n";

    if (file_put_contents($fdfPath, $fdf) === false) {
        throw new Exception('Could not create temporary FDF data file.');
    }
}

function fillApprovalTemplatePdf($templatePath, $outputPdfPath, $fields, $checkboxes) {
    if (!file_exists($templatePath)) {
        throw new Exception('Approval template PDF was not found: ' . $templatePath);
    }

    $pdftk = '/usr/local/bin/pdftk';

    if (!$pdftk) {
        throw new Exception('pdftk was not found. Install pdftk-java/pdftk and make sure the pdftk command is available to XAMPP/PHP.');
    }

    $outputDir = dirname($outputPdfPath);
    if (!is_dir($outputDir)) {
        mkdir($outputDir, 0777, true);
    }
    @chmod($outputDir, 0777);

    $tempDir = __DIR__ . '/magick_tmp';
    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }
    @chmod($tempDir, 0777);

    $fdfPath = $tempDir . '/approval_' . uniqid('', true) . '.fdf';
    writeApprovalFdf($fields, $checkboxes, $fdfPath);

    $cmd =
        'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
        escapeshellcmd($pdftk) . ' ' .
        escapeshellarg($templatePath) . ' ' .
        'fill_form ' . escapeshellarg($fdfPath) . ' ' .
        'output ' . escapeshellarg($outputPdfPath) . ' ' .
        'need_appearances ' .
        '2>&1';

    exec($cmd, $out, $ret);

    if (file_exists($fdfPath)) {
        @unlink($fdfPath);
    }

    if ($ret !== 0 || !file_exists($outputPdfPath) || filesize($outputPdfPath) <= 0) {
        throw new Exception('pdftk could not create the filled approval PDF: ' . implode("\n", $out));
    }
}


function findPythonBinary() {
    return '/Library/Developer/CommandLineTools/usr/bin/python3';
}

function placeUploadedArtworkOnApprovalPdf($filledPdfPath, $artworkPath, $finalPdfPath) {
    if (!file_exists($filledPdfPath)) {
        throw new Exception('Filled approval PDF was not found before placing artwork.');
    }

    if (!file_exists($artworkPath)) {
        throw new Exception('Uploaded artwork file was not found before placing into approval.');
    }

    $helperScript = __DIR__ . '/place_approval_art.py';
    if (!file_exists($helperScript)) {
        throw new Exception('Artwork placement helper was not found: ' . $helperScript);
    }

    $python = findPythonBinary();
    if (!$python) {
        throw new Exception('python3 was not found. Install Python 3 or make sure python3 is available to XAMPP/PHP.');
    }

    /*
        Artwork placement box in PDF points: x, y, width, height.
        PDF coordinates start at the bottom-left of the page.
        This box targets the large blank white artwork area in HCC APPROVAL FORM-2026.pdf.
    */
    $artBox = '26,150,740,385';

    $cmd =
        'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
        escapeshellcmd($python) . ' ' .
        escapeshellarg($helperScript) . ' ' .
        '--base ' . escapeshellarg($filledPdfPath) . ' ' .
        '--art ' . escapeshellarg($artworkPath) . ' ' .
        '--out ' . escapeshellarg($finalPdfPath) . ' ' .
        '--box ' . escapeshellarg($artBox) . ' ' .
        '2>&1';

    exec($cmd, $out, $ret);

    if ($ret !== 0 || !file_exists($finalPdfPath) || filesize($finalPdfPath) <= 0) {
        throw new Exception('Could not place uploaded artwork into approval PDF: ' . implode("\n", $out));
    }
}


function findGhostscriptBinaryForSnapshot() {
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

function renderApprovalPdfSnapshot($pdfFullPath, $jpgOutPath) {
    if (!file_exists($pdfFullPath)) {
        throw new Exception('Approval PDF could not be found for snapshot: ' . $pdfFullPath);
    }

    $gs = findGhostscriptBinaryForSnapshot();
    if (!$gs) {
        throw new Exception('Ghostscript was not found. It is needed to create approval revision snapshots.');
    }

    $snapshotDir = dirname($jpgOutPath);
    if (!is_dir($snapshotDir)) {
        mkdir($snapshotDir, 0777, true);
    }
    @chmod($snapshotDir, 0777);

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
        ' -dJPEGQ=88' .
        ' -r120' .
        ' -dGraphicsAlphaBits=4' .
        ' -dTextAlphaBits=4' .
        ' -sOutputFile=' . escapeshellarg($jpgOutPath) .
        ' ' . escapeshellarg($pdfFullPath) .
        ' 2>&1';

    exec($cmd, $out, $ret);

    if ($ret !== 0 || !file_exists($jpgOutPath) || filesize($jpgOutPath) <= 0) {
        throw new Exception('Could not create approval revision snapshot: ' . implode("\n", $out));
    }
}

function snapshotLatestApprovalRevisionIfNeeded($db, $gNumber, $currentApprovalPdfFullPath) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '' || !file_exists($currentApprovalPdfFullPath)) {
        return '';
    }

    $latestRevision = getLatestApprovalRevisionInfo($db, $cleanG);
    if (!$latestRevision || empty($latestRevision['id'])) {
        return '';
    }

    $rev = strtoupper(trim((string)($latestRevision['rev'] ?? '')));
    if ($rev === '') {
        $rev = 'UNKNOWN';
    }

    $safeRev = preg_replace('/[^A-Z0-9_-]/i', '_', $rev);
    $snapshotDir = __DIR__ . '/approval_snapshots';
    if (!is_dir($snapshotDir)) {
        mkdir($snapshotDir, 0777, true);
    }
    @chmod($snapshotDir, 0777);

    $snapshotFilename = $cleanG . '_REV_' . $safeRev . '_SNAPSHOT.jpg';
    $snapshotFullPath = $snapshotDir . '/' . $snapshotFilename;
    $snapshotWebPath = 'approval_snapshots/' . $snapshotFilename;

    renderApprovalPdfSnapshot($currentApprovalPdfFullPath, $snapshotFullPath);

    $stmt = $db->prepare("\n        UPDATE approval_revisions\n        SET snapshot_image = :snapshot_image,\n            approval_pdf = ''\n        WHERE id = :id\n    ");
    $stmt->bindValue(':snapshot_image', $snapshotWebPath);
    $stmt->bindValue(':id', intval($latestRevision['id']), SQLITE3_INTEGER);
    $stmt->execute();

    return $snapshotWebPath;
}

function buildRevisionedGNumber($gNumber, $rev) {
    $cleanG = preg_replace('/[^0-9]/', '', $gNumber ?? '');
    $cleanRev = strtoupper(trim((string)($rev ?? '')));

    if ($cleanG === '') {
        return '';
    }

    if ($cleanRev === '' || $cleanRev === '0') {
        return $cleanG;
    }

    return $cleanG . '-' . $cleanRev;
}

function buildApprovalPdfFields($data, $approvalRevisionsForPdf) {
    $fields = [
        'CUSTOMER' => $data['customer_name'] ?? '',
        'CUST #' => $data['customer_number'] ?? '',
        'SPEC #' => $data['spec_number'] ?? '',
        'DESIGN #' => $data['design_number'] ?? '',
        'ART #' => buildRevisionedGNumber($data['g_number'] ?? '', $data['rev'] ?? ''),
        'I.D' => $data['item_description'] ?? '',
        'TEST' => $data['test_flute'] ?? '',
        'Sales Rep' => $data['sales_rep'] ?? '',
        'APPROVAL CREATION DATE' => $data['approval_date'] ?? '',
        'DATE APPROVED' => '',
        'Signature1_es_:signer:signature' => ''
    ];

    $approvalRevisionsForPdf = array_values(array_slice($approvalRevisionsForPdf, -4));

    for ($i = 0; $i < 4; $i++) {
        $row = $approvalRevisionsForPdf[$i] ?? [];
        $fields['ART REV ' . $i] = strtoupper(trim((string)($row['rev'] ?? '')));
        $fields['rev date ' . $i] = strtoupper(trim((string)($row['rev_date'] ?? '')));
        $fields['DESCR ' . $i] = strtoupper(trim((string)($row['description'] ?? '')));
        $fields['CSR ' . $i] = strtoupper(trim((string)($row['csr'] ?? '')));
        $fields['DSR ' . $i] = strtoupper(trim((string)($row['dsr'] ?? '')));
    }

    return $fields;
}

function buildApprovalPdfCheckboxes($data) {
    return [
        'Check Box SAMPLE' => false,
        'Check Box APPROVED' => false,
        'Check Box DIGITAL PRINT' => !empty($data['digital_print']),
        'Check Box DIGITAL CUT' => !empty($data['digital_cut']),
        'Check Box DIE CUT BAYSEK' => !empty($data['digital_die_cut']),
        'Check Box DIE CUT LABEL' => !empty($data['label_die_cut']),
        'Check Box PROCESS' => !empty($data['label_4c_process'])
    ];
}



function getGraphicByGNumber($db, $gNumber) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '') {
        return null;
    }

    $stmt = $db->prepare("
        SELECT *
        FROM graphics
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
        LIMIT 1
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);

    return $row ?: null;
}

function getLatestRevisionInfo($db, $gNumber) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '') {
        return null;
    }

    $stmt = $db->prepare("
        SELECT *
        FROM print_card_revisions
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
        ORDER BY 
            CASE 
                WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER)
                ELSE -1
            END DESC,
            id DESC
        LIMIT 1
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);

    return $row ?: null;
}

function getLatestApprovalRevisionInfo($db, $gNumber) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '') {
        return null;
    }

    $stmt = $db->prepare("
        SELECT *
        FROM approval_revisions
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
        ORDER BY 
            CASE 
                WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER)
                ELSE -1
            END DESC,
            id DESC
        LIMIT 1
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);

    return $row ?: null;
}

function getNextApprovalRev($db, $gNumber) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '') {
        return '0';
    }

    // Direct lookup: find the highest numeric approval revision for this G#.
    // If no rows exist, next rev is 0. If highest is 0, next rev is 1.
    $stmt = $db->prepare("
        SELECT MAX(CAST(rev AS INTEGER)) AS max_rev, COUNT(*) AS total_rows
        FROM approval_revisions
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
        AND rev GLOB '[0-9]*'
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);

    $totalRows = intval($row['total_rows'] ?? 0);

    if ($totalRows <= 0 || $row['max_rev'] === null || $row['max_rev'] === '') {
        // If an approval PDF already exists but no revision rows exist yet,
        // it was created before revision tracking. Treat that existing approval as Rev 0.
        return hasExistingApprovalPreview($db, $cleanG) ? '1' : '0';
    }

    return (string)(intval($row['max_rev']) + 1);
}

function getApprovalRevisionCount($db, $gNumber) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '') {
        return 0;
    }

    $stmt = $db->prepare("
        SELECT COUNT(*) AS total_rows
        FROM approval_revisions
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);

    $count = intval($row['total_rows'] ?? 0);

    if ($count <= 0 && hasExistingApprovalPreview($db, $cleanG)) {
        return 1;
    }

    return $count;
}

function getRawApprovalRevisionCount($db, $gNumber) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '') {
        return 0;
    }

    $stmt = $db->prepare("
        SELECT COUNT(*) AS total_rows
        FROM approval_revisions
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);

    return intval($row['total_rows'] ?? 0);
}

function hasExistingApprovalPreview($db, $gNumber) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '') {
        return false;
    }

    $stmt = $db->prepare("
        SELECT preview_image
        FROM graphics
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
        LIMIT 1
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);

    $preview = $row['preview_image'] ?? '';

    return ($preview && strpos($preview, 'approvals/') === 0);
}

function bootstrapApprovalRevisionIfNeeded($db, $gNumber) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '') {
        return;
    }

    if (getRawApprovalRevisionCount($db, $cleanG) > 0) {
        return;
    }

    if (!hasExistingApprovalPreview($db, $cleanG)) {
        return;
    }

    // Existing approval file was made before revision tracking existed.
    // Create a Rev 0 placeholder so the next generated approval becomes Rev 1.
    $stmt = $db->prepare("
        INSERT INTO approval_revisions
        (g_number, rev, rev_date, description, csr, dsr, d_number, approval_pdf)
        VALUES
        (:g_number, '0', :rev_date, 'FOR APPROVAL', '', '', '', 'approvals/' || :g_number || '_APPROVAL.pdf')
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $stmt->bindValue(':rev_date', date('n/j/y'));
    $stmt->execute();
}

function getLatestApprovalRevisionsForDisplay($db, $gNumber, $limit = 4) {
    $cleanG = cleanNumberOnly($gNumber);

    if ($cleanG === '') {
        return [];
    }

    $stmt = $db->prepare("
        SELECT *
        FROM approval_revisions
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $result = $stmt->execute();

    $all = [];

    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $revRaw = strtoupper(trim((string)($row['rev'] ?? '')));

        if (preg_match('/^\d+$/', $revRaw)) {
            $row['_sort_type'] = 0;
            $row['_sort_number'] = intval($revRaw);
            $row['_sort_text'] = '';
        } else {
            $row['_sort_type'] = 1;
            $row['_sort_number'] = 999999;
            $row['_sort_text'] = $revRaw;
        }

        $row['_sort_id'] = intval($row['id'] ?? 0);
        $all[] = $row;
    }

    usort($all, function($a, $b) {
        if ($a['_sort_type'] !== $b['_sort_type']) {
            return $a['_sort_type'] <=> $b['_sort_type'];
        }

        if ($a['_sort_number'] !== $b['_sort_number']) {
            return $a['_sort_number'] <=> $b['_sort_number'];
        }

        if ($a['_sort_text'] !== $b['_sort_text']) {
            return strcmp($a['_sort_text'], $b['_sort_text']);
        }

        return $a['_sort_id'] <=> $b['_sort_id'];
    });

    $selected = array_slice($all, -$limit);

    foreach ($selected as &$row) {
        unset($row['_sort_type'], $row['_sort_number'], $row['_sort_text'], $row['_sort_id']);
    }

    return $selected;
}

if (isset($_GET['lookup_g']) && $_GET['lookup_g'] === '1') {
    header('Content-Type: application/json');

    $gNumber = cleanNumberOnly($_GET['g_number'] ?? '');
    $graphic = getGraphicByGNumber($db, $gNumber);
    $latestRev = getLatestRevisionInfo($db, $gNumber);

    if (!$graphic) {
        echo json_encode([
            'success' => false,
            'message' => 'No G# found.'
        ]);
        exit;
    }

    $latestApprovalRev = getLatestApprovalRevisionInfo($db, $gNumber);
    $nextApprovalRev = getNextApprovalRev($db, $gNumber);
    $approvalRevisionCount = getApprovalRevisionCount($db, $gNumber);

    echo json_encode([
        'success' => true,
        'graphic' => [
            'g_number' => cleanNumberOnly($graphic['g_number'] ?? ''),
            'customer_number' => $graphic['customer_number'] ?? '',
            'customer_name' => $graphic['customer_name'] ?? '',
            'part_number' => $graphic['part_number'] ?? '',
            'preview_image' => $graphic['preview_image'] ?? ''
        ],
        'latest_revision' => $latestRev ? [
            'd_number' => $latestRev['d_number'] ?? '',
            'csr' => $latestRev['csr'] ?? '',
            'des' => $latestRev['des'] ?? '',
            'rev' => $latestRev['rev'] ?? ''
        ] : null,
        'latest_approval_revision' => $latestApprovalRev,
        'latest_approval_revisions' => getLatestApprovalRevisionsForDisplay($db, $gNumber, 4),
        'next_approval_rev' => $nextApprovalRev,
        'approval_revision_count' => $approvalRevisionCount
    ]);
    exit;
}

if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'create_approval') {
    try {
        $gNumber = cleanNumberOnly($_POST['g_number'] ?? '');

        if ($gNumber === '') {
            throw new Exception("Missing G#.");
        }

        $graphic = getGraphicByGNumber($db, $gNumber);

        if (!$graphic) {
            throw new Exception("Could not find G# " . $gNumber . " in the graphics database.");
        }

        $templatePath = __DIR__ . '/HCC APPROVAL FORM-2026.pdf';
        $uploadDir = __DIR__ . '/approval_uploads';
        $approvalDir = __DIR__ . '/approvals';
        $snapshotDir = __DIR__ . '/approval_snapshots';

        foreach ([$uploadDir, $approvalDir, $snapshotDir] as $dir) {
            if (!is_dir($dir)) {
                mkdir($dir, 0777, true);
            }
            @chmod($dir, 0777);
        }

        $uploadedArtPath = '';

        // The PDF template workflow fills the Acrobat form fields directly.
        // Uploaded artwork is saved separately for manual placement/editing in Acrobat if needed.
        if (
            isset($_FILES['approval_art']) &&
            $_FILES['approval_art']['error'] === UPLOAD_ERR_OK &&
            !empty($_FILES['approval_art']['tmp_name'])
        ) {
            $originalName = $_FILES['approval_art']['name'] ?? 'approval_art';
            $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
            $allowed = ['pdf', 'jpg', 'jpeg', 'png'];

            if (!in_array($ext, $allowed, true)) {
                throw new Exception("Approval artwork must be a PDF, JPG, JPEG, or PNG.");
            }

            $uploadedArtPath = $uploadDir . '/approval_art_' . $gNumber . '_' . time() . '.' . $ext;

            if (!move_uploaded_file($_FILES['approval_art']['tmp_name'], $uploadedArtPath)) {
                throw new Exception("Could not save uploaded approval artwork.");
            }
        }

        $latestRevision = getLatestRevisionInfo($db, $gNumber);

        // If this G# already has an approval PDF but no revision rows yet,
        // seed Rev 0 before calculating the next revision.
        bootstrapApprovalRevisionIfNeeded($db, $gNumber);

        $latestApprovalRevision = getLatestApprovalRevisionInfo($db, $gNumber);
        $nextApprovalRev = getNextApprovalRev($db, $gNumber);

        $data = [
            'g_number' => $gNumber,
            'customer_number' => forceUpperText($_POST['customer_number'] ?? ($graphic['customer_number'] ?? '')),
            'customer_name' => forceUpperText($_POST['customer_name'] ?? ($graphic['customer_name'] ?? '')),
            'part_number' => forceUpperText($_POST['part_number'] ?? ($graphic['part_number'] ?? '')),
            'item_description' => forceUpperText($_POST['item_description'] ?? ($graphic['part_number'] ?? '')),
            'spec_number' => forceUpperText($_POST['spec_number'] ?? ''),
            'design_number' => cleanAlphaNumber($_POST['design_number'] ?? ($latestApprovalRevision['d_number'] ?? '')),
            'test_flute' => forceUpperText($_POST['test_flute'] ?? ''),
            'sales_rep' => forceUpperText($_POST['sales_rep'] ?? ''),
            'approval_date' => forceUpperText($_POST['approval_date'] ?? date('n/j/y')),
            'rev' => $nextApprovalRev,
            'rev_date' => forceUpperText($_POST['rev_date'] ?? date('n/j/y')),
            'rev_description' => forceUpperText($_POST['rev_description'] ?? 'FOR APPROVAL'),
            'csr' => forceUpperText($_POST['csr'] ?? ($latestApprovalRevision['csr'] ?? '')),
            'dsr' => forceUpperText($_POST['dsr'] ?? ($latestApprovalRevision['dsr'] ?? '')),
            'digital_print' => isset($_POST['digital_print']),
            'digital_cut' => isset($_POST['digital_cut']),
            'digital_die_cut' => isset($_POST['digital_die_cut']),
            'label_die_cut' => isset($_POST['label_die_cut']),
            'label_4c_process' => isset($_POST['label_4c_process']),
        ];

        // Use stable filenames so a new approval replaces the previous approval for this G#.
        $fileStem = $gNumber . '_APPROVAL';
        $approvalPdfPath = $approvalDir . '/' . $fileStem . '.pdf';
        $approvalWeb = 'approvals/' . $fileStem . '.pdf';

        // Before replacing the current approval PDF, save the previous approval as a lightweight JPG snapshot.
        $oldPreview = $graphic['preview_image'] ?? '';
        $previousSnapshotWeb = '';
        if ($oldPreview && strpos($oldPreview, 'approvals/') === 0) {
            $oldFullPath = __DIR__ . '/' . str_replace(['../', '..\\'], '', $oldPreview);

            if (file_exists($oldFullPath)) {
                $previousSnapshotWeb = snapshotLatestApprovalRevisionIfNeeded($db, $gNumber, $oldFullPath);
                @unlink($oldFullPath);
            }

            $oldJpgPath = preg_replace('/\.pdf$/i', '.jpg', $oldFullPath);
            if ($oldJpgPath && $oldJpgPath !== $oldFullPath && file_exists($oldJpgPath)) {
                @unlink($oldJpgPath);
            }

            $oldTempJpgPath = preg_replace('/\.pdf$/i', '_temp.jpg', $oldFullPath);
            if ($oldTempJpgPath && $oldTempJpgPath !== $oldFullPath && file_exists($oldTempJpgPath)) {
                @unlink($oldTempJpgPath);
            }
        }

        $currentApprovalRevision = [
            'rev' => $data['rev'],
            'rev_date' => $data['rev_date'],
            'description' => $data['rev_description'],
            'csr' => $data['csr'],
            'dsr' => $data['dsr'],
            'd_number' => $data['design_number']
        ];

        $approvalRevisionsForPdf = getLatestApprovalRevisionsForDisplay($db, $gNumber, 3);
        $approvalRevisionsForPdf[] = $currentApprovalRevision;

        $pdfFields = buildApprovalPdfFields($data, $approvalRevisionsForPdf);
        $pdfCheckboxes = buildApprovalPdfCheckboxes($data);

        if ($uploadedArtPath) {
            // Build the approval like Acrobat's background workflow:
            // 1) place the uploaded artwork into the blank artwork area on a clean template
            // 2) fill the editable form fields afterward so fields remain clean/editable and sit above the artwork
            $artBackgroundPdfPath = $approvalDir . '/' . $fileStem . '_art_background_temp.pdf';
            placeUploadedArtworkOnApprovalPdf($templatePath, $uploadedArtPath, $artBackgroundPdfPath);
            fillApprovalTemplatePdf($artBackgroundPdfPath, $approvalPdfPath, $pdfFields, $pdfCheckboxes);

            if (file_exists($artBackgroundPdfPath)) {
                @unlink($artBackgroundPdfPath);
            }
        } else {
            fillApprovalTemplatePdf($templatePath, $approvalPdfPath, $pdfFields, $pdfCheckboxes);
        }

        $stmt = $db->prepare("
            UPDATE graphics
            SET preview_image = :preview_image
            WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
        ");
        $stmt->bindValue(':preview_image', $approvalWeb);
        $stmt->bindValue(':g_number', $gNumber);
        $stmt->execute();

        $insertApprovalRevision = $db->prepare("
            INSERT INTO approval_revisions
            (g_number, rev, rev_date, description, csr, dsr, d_number, customer_number, customer_name, spec_number, item_description, test_flute, sales_rep, approval_date, digital_print, digital_cut, digital_die_cut, label_die_cut, label_4c_process, approval_pdf, snapshot_image)
            VALUES
            (:g_number, :rev, :rev_date, :description, :csr, :dsr, :d_number, :customer_number, :customer_name, :spec_number, :item_description, :test_flute, :sales_rep, :approval_date, :digital_print, :digital_cut, :digital_die_cut, :label_die_cut, :label_4c_process, :approval_pdf, '')
        ");
        $insertApprovalRevision->bindValue(':g_number', $gNumber);
        $insertApprovalRevision->bindValue(':rev', $data['rev']);
        $insertApprovalRevision->bindValue(':rev_date', $data['rev_date']);
        $insertApprovalRevision->bindValue(':description', $data['rev_description']);
        $insertApprovalRevision->bindValue(':csr', $data['csr']);
        $insertApprovalRevision->bindValue(':dsr', $data['dsr']);
        $insertApprovalRevision->bindValue(':d_number', $data['design_number']);
        $insertApprovalRevision->bindValue(':customer_number', $data['customer_number']);
        $insertApprovalRevision->bindValue(':customer_name', $data['customer_name']);
        $insertApprovalRevision->bindValue(':spec_number', $data['spec_number']);
        $insertApprovalRevision->bindValue(':item_description', $data['item_description']);
        $insertApprovalRevision->bindValue(':test_flute', $data['test_flute']);
        $insertApprovalRevision->bindValue(':sales_rep', $data['sales_rep']);
        $insertApprovalRevision->bindValue(':approval_date', $data['approval_date']);
        $insertApprovalRevision->bindValue(':digital_print', $data['digital_print'] ? '1' : '0');
        $insertApprovalRevision->bindValue(':digital_cut', $data['digital_cut'] ? '1' : '0');
        $insertApprovalRevision->bindValue(':digital_die_cut', $data['digital_die_cut'] ? '1' : '0');
        $insertApprovalRevision->bindValue(':label_die_cut', $data['label_die_cut'] ? '1' : '0');
        $insertApprovalRevision->bindValue(':label_4c_process', $data['label_4c_process'] ? '1' : '0');
        $insertApprovalRevision->bindValue(':approval_pdf', $approvalWeb);
        $insertApprovalRevision->execute();

        $createdApprovalWeb = $approvalWeb;
        $message = 'Approval PDF created from fillable template and saved to G#' . htmlspecialchars($gNumber) . ' preview spot. Previous approval was replaced.';

        if ($previousSnapshotWeb) {
            $message .= ' Previous approval revision was saved as a JPG snapshot.';
        }

        if ($uploadedArtPath) {
            $message .= ' Uploaded artwork was placed into the approval artwork area as the approval background.';
        }

        $messageType = 'success';
        $selectedGraphic = getGraphicByGNumber($db, $gNumber);

    } catch (Exception $e) {
        $message = 'Error creating approval: ' . htmlspecialchars($e->getMessage());
        $messageType = 'error';
    }
}

$searchG = cleanNumberOnly($_GET['g_number'] ?? ($_POST['g_number'] ?? ''));

if ($searchG && !$selectedGraphic) {
    $selectedGraphic = getGraphicByGNumber($db, $searchG);
}

$latestRevision = $selectedGraphic ? getLatestRevisionInfo($db, $selectedGraphic['g_number']) : null;
$latestApprovalRevision = $selectedGraphic ? getLatestApprovalRevisionInfo($db, $selectedGraphic['g_number']) : null;

// PHP-side Rev autofill. This does not depend on JavaScript.
$defaultApprovalRev = '0';
if ($selectedGraphic) {
    $defaultApprovalRev = getNextApprovalRev($db, $selectedGraphic['g_number']);
}
$defaultApprovalCSR = $latestApprovalRevision['csr'] ?? ($latestRevision['csr'] ?? '');
$defaultApprovalDSR = $latestApprovalRevision['dsr'] ?? ($latestRevision['des'] ?? '');

$defaultCustomerNumber = $selectedGraphic['customer_number'] ?? '';
$defaultCustomerName = $selectedGraphic['customer_name'] ?? '';
$defaultPartNumber = $selectedGraphic['part_number'] ?? '';
$defaultGNumber = $selectedGraphic ? cleanNumberOnly($selectedGraphic['g_number'] ?? '') : $searchG;
$defaultDesignNumber = $latestApprovalRevision['d_number'] ?? '';
$defaultCSR = $defaultApprovalCSR;
$defaultDSR = $defaultApprovalDSR;
$approvalHistory = $selectedGraphic ? getLatestApprovalRevisionsForDisplay($db, $selectedGraphic['g_number'], 4) : [];
?>

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/gm2-base.css?v=<?php echo filemtime('assets/css/gm2-base.css'); ?>">
<link rel="stylesheet" href="assets/css/gm2-create-approval.css?v=<?php echo filemtime('assets/css/gm2-create-approval.css'); ?>">
<title>Create Approval</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">

</head>

<?php $isApprovalsEmbed = isset($_GET['embed']) && $_GET['embed'] === '1'; ?>
<body class="create-approval-page<?php echo $isApprovalsEmbed ? ' embedded-approval-tab' : ''; ?>">
<div class="wrapper">
    <header>
        <img class="app-logo" src="SUMTER HC-LOGO-HORIZONTAL-web.png" alt="Logo">
        <h1>Create Approval</h1>
        <p class="subtitle">Create approval previews and attach them directly to a G#.</p>

        <nav class="page-nav" aria-label="Page navigation">
            <a href="index.php">G# List</a>
            <a class="active" href="create_approval.php">Create Approval</a>
            <a href="approval_revisions.php">Approval Revisions</a>
            <a href="printcard_revisions.php">Print Card Revisions</a>
            <a class="logout-link" href="admin.php">Admin</a>
        </nav>

        <div class="gm2-stat-strip create-approval-stat-strip" aria-label="Create approval workflow stats">
            <div class="gm2-stat-item">
                <span class="gm2-stat-label">Loaded G#</span>
                <span class="gm2-stat-value" id="loadedGStat"><?php echo $defaultGNumber ? 'G#' . htmlspecialchars($defaultGNumber) : 'None'; ?></span>
            </div>
            <div class="gm2-stat-item">
                <span class="gm2-stat-label">Next Rev</span>
                <span class="gm2-stat-value" id="nextRevStat"><?php echo htmlspecialchars($defaultApprovalRev); ?></span>
            </div>
            <div class="gm2-stat-item">
                <span class="gm2-stat-label">History</span>
                <span class="gm2-stat-value" id="historyCountStat"><?php echo count($approvalHistory); ?></span>
            </div>
        </div>
    </header>

    <?php if ($message): ?>
        <div class="message gm2-message <?php echo $messageType === 'error' ? 'error' : 'success'; ?>">
            <?php echo $message; ?>
        </div>
    <?php endif; ?>

    <section class="card gm-card create-lookup-card">
        <div class="gm2-section-kicker">Lookup</div>
        <h2>Find G#</h2>

        <form method="GET" class="lookup-row create-lookup-form">
            <div>
                
                <input 
                    type="text" 
                    name="g_number" 
                    id="lookup_g_number" 
                    value="<?php echo htmlspecialchars($defaultGNumber); ?>" 
                    placeholder="Example: 12869"
                    autocomplete="off"
                >
            </div>

            <button type="submit" class="gm-btn gm-btn-primary">Load G#</button>
        </form>

        <?php if ($searchG && !$selectedGraphic): ?>
            <p class="muted mt-10">No matching G# found.</p>
        <?php endif; ?>
    </section>

    <form method="POST" enctype="multipart/form-data" id="approvalForm">
        <input type="hidden" name="action" value="create_approval">

        <section class="card gm-card create-approval-main-card">
            <div class="create-approval-header-row">
                <div>
                    <div class="gm2-section-kicker">Approval Information</div>
                    <h2>Build Approval PDF</h2>
                    <p class="muted">Load a G#, confirm the approval details, add optional production flags, then generate the approval preview.</p>
                </div>
            </div>

            <div class="create-subcard customer-info-card">
                <div class="gm2-section-kicker">Customer Information</div>
                <div class="create-form-grid five-col">
                    <div>
                        <label>Customer</label>
                        <input name="customer_name" id="customer_name" value="<?php echo htmlspecialchars($defaultCustomerName); ?>">
                    </div>

                    <div>
                        <label>Customer #</label>
                        <input name="customer_number" id="customer_number" value="<?php echo htmlspecialchars($defaultCustomerNumber); ?>">
                    </div>

                    <div>
                        <label>Spec #</label>
                        <input name="spec_number" id="spec_number" placeholder="Optional">
                    </div>

                    <div>
                        <label>Design # / D#</label>
                        <input name="design_number" id="design_number" value="<?php echo htmlspecialchars($defaultDesignNumber); ?>">
                    </div>

                    <div>
                        
                        <label>G#</label>
                        <input name="g_number" id="g_number" value="<?php echo htmlspecialchars($defaultGNumber); ?>" required>
                    </div>
                </div>

                <div class="create-field-stack">
                    <label>Item Description</label>
                    <textarea name="item_description" id="item_description" placeholder="Example: 12X12X12 BAMBERG"><?php echo htmlspecialchars($defaultPartNumber); ?></textarea>
                </div>

                <div class="create-form-grid three-col create-post-description-grid">
                    <div>
                        <label>Test & Flute</label>
                        <input name="test_flute" id="test_flute" placeholder="Example: 200 ECT C KRAFT">
                    </div>

                    <div>
                        <label>Sales Rep</label>
                        <input name="sales_rep" id="sales_rep" placeholder="Example: MW">
                    </div>

                    <div>
                        <label>Approval Date</label>
                        <input name="approval_date" id="approval_date" value="<?php echo strtoupper(date('n/j/y')); ?>">
                    </div>
                </div>
            </div>

            <div class="create-subcard approval-details-card">
                <div class="gm2-section-kicker">Approval Details</div>
                <div class="create-form-grid approval-detail-grid">
                    <div>
                        <label>Rev</label>
                        <input name="rev" id="rev" value="<?php echo htmlspecialchars($defaultApprovalRev); ?>">
                    </div>

                    <div>
                        <label>Rev Date</label>
                        <input name="rev_date" id="rev_date" value="<?php echo strtoupper(date('n/j/y')); ?>">
                    </div>

                    <div>
                        <label>Rev Description</label>
                        <input name="rev_description" id="rev_description" value="FOR APPROVAL">
                    </div>

                    <div>
                        <label>CSR <span class="label-hint">initials</span></label>
                        <input name="csr" id="csr" value="<?php echo htmlspecialchars($defaultCSR); ?>">
                    </div>

                    <div>
                        <label>DSR <span class="label-hint">initials</span></label>
                        <input name="dsr" id="dsr" value="<?php echo htmlspecialchars($defaultDSR); ?>">
                    </div>
                </div>

                <p class="muted create-rev-note">
                    Rev auto-fills to the next approval revision for this G#. You can still override it if needed.
                    <span id="approvalRevDebug"></span>
                </p>
            </div>

            <div class="create-subcard production-options-card">
                <div class="production-options-grid">
                    <div class="production-option-group">
                        <div class="gm2-section-kicker">Digital</div>
                        <div class="create-check-grid compact">
                            <label class="check-row">
                                <input type="checkbox" name="digital_print">
                                Digital Print
                            </label>
                            <label class="check-row">
                                <input type="checkbox" name="digital_cut">
                                Digital Cut
                            </label>
                            <label class="check-row">
                                <input type="checkbox" name="digital_die_cut">
                                Die Cut (Baysek)
                            </label>
                        </div>
                    </div>

                    <div class="production-option-group">
                        <div class="gm2-section-kicker">Label</div>
                        <div class="create-check-grid compact label-options">
                            <label class="check-row">
                                <input type="checkbox" name="label_die_cut">
                                Label Die Cut
                            </label>
                            <label class="check-row">
                                <input type="checkbox" name="label_4c_process">
                                4-C Process
                            </label>
                        </div>
                    </div>
                </div>

            </div>

            <div class="create-subcard artwork-upload-card">
                <div class="gm2-section-kicker">Artwork Upload</div>
                <label>Approval Artwork PDF/JPG/PNG</label>
                <div class="artwork-upload-shell">
                    <input id="approval_art" type="file" name="approval_art" accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png">
                    <div class="artwork-upload-preview" id="artworkUploadPreview">
                        <span>No artwork selected</span>
                    </div>
                </div>
                <p class="muted">Optional: upload the art/dieline file and it will be placed into the approval artwork area as the approval background. The form fields stay editable in Acrobat.</p>
            </div>

            <div class="create-subcard approval-history-card" id="approvalHistoryCard">
                <div class="approval-history-title-row">
                    <div>
                        <div class="gm2-section-kicker">Approval History</div>
                        <h3>Latest Approval Revisions</h3>
                    </div>
                    <?php if ($defaultGNumber): ?>
                        <a class="gm-btn gm-btn-secondary gm-btn-compact" href="approval_revisions.php?q_search=<?php echo urlencode($defaultGNumber); ?>">View All</a>
                    <?php endif; ?>
                </div>

                <div class="approval-history-list" id="approvalHistoryList">
                    <?php if (!empty($approvalHistory)): ?>
                        <?php foreach ($approvalHistory as $historyRow): ?>
                            <div class="approval-history-row">
                                <span><strong>Rev <?php echo htmlspecialchars($historyRow['rev'] ?? ''); ?></strong></span>
                                <span><?php echo htmlspecialchars($historyRow['rev_date'] ?? ''); ?></span>
                                <span><?php echo htmlspecialchars($historyRow['description'] ?? ''); ?></span>
                                <span>CSR: <?php echo htmlspecialchars($historyRow['csr'] ?? ''); ?></span>
                                <span>DSR: <?php echo htmlspecialchars($historyRow['dsr'] ?? ''); ?></span>
                            </div>
                        <?php endforeach; ?>
                    <?php else: ?>
                        <p class="muted approval-history-empty">No approval revision history loaded yet.</p>
                    <?php endif; ?>
                </div>
            </div>

            <div class="form-actions create-form-actions">
                <button type="submit" class="gm-btn gm-btn-primary">Generate Approval</button>
                <a class="button-link secondary gm-btn gm-btn-secondary" href="index.php">Back to G# List</a>
            </div>
        </section>
    </form>

    <?php if ($createdApprovalWeb): ?>
        <div id="approvalPopup" class="approval-popup active" onclick="closeApprovalPopup()">
            <div class="approval-popup-box" onclick="event.stopPropagation()">
                <div class="approval-popup-top">
                    <div>
                        <h2>Approval PDF Created</h2>
                        <p class="muted gm-no-margin-bottom">The generated approval PDF was attached to this G# preview.</p>
                    </div>
                    <div class="approval-popup-actions">
                        <a class="button-link gm-btn gm-btn-secondary" href="create_approval.php?gm2_download=1&file=<?php echo urlencode($createdApprovalWeb); ?>&name=<?php echo urlencode(basename($createdApprovalWeb)); ?>">Download PDF</a>
                        <button type="button" class="gm-btn gm-btn-primary" onclick="printApprovalPopup()">Print</button>
                        <button type="button" class="close-modal gm-btn gm-btn-danger" onclick="closeApprovalPopup()">×</button>
                    </div>
                </div>

                <div class="view-image-wrap" style="flex:1; min-height:0;">
                    <img
                        id="approvalPopupImage"
                        src="create_approval.php?gm2_pdf_preview=1&file=<?php echo urlencode($createdApprovalWeb); ?>&v=<?php echo time(); ?>"
                        alt="Created Approval Preview"
                        style="width:100%; height:100%; object-fit:contain; background:white; border-radius:5px;"
                    >
                </div>
                <iframe 
                    id="approvalPopupFrame"
                    src="<?php echo htmlspecialchars($createdApprovalWeb); ?>?v=<?php echo time(); ?>"
                    title="Created Approval PDF"
                    style="display:none;">
                </iframe>
            </div>
        </div>

        <section class="card gm-card create-result-card">
            <div class="gm2-section-kicker">Created</div>
            <h2>Approval PDF Created</h2>
            <div class="form-actions create-form-actions">
                <button type="button" class="gm-btn gm-btn-primary" onclick="openApprovalPopup()">Open Approval Preview</button>
                <a class="button-link secondary gm-btn gm-btn-secondary" href="index.php">Back to G# List</a>
            </div>
        </section>
    <?php elseif ($selectedGraphic && !empty($selectedGraphic['preview_image'])): ?>
        <section class="card gm-card current-preview-card">
            <div class="gm2-section-kicker">Current Preview</div>
            <h2>Current G# Preview</h2>
            <div class="preview-wrap current-preview-wrap">
                <?php if (strtolower(pathinfo($selectedGraphic['preview_image'], PATHINFO_EXTENSION)) === 'pdf'): ?>
                    <iframe
                        src="<?php echo htmlspecialchars($selectedGraphic['preview_image']); ?>?v=<?php echo time(); ?>"
                        title="Current Approval PDF">
                    </iframe>
                <?php else: ?>
                    <img class="approval-preview" src="<?php echo htmlspecialchars($selectedGraphic['preview_image']); ?>?v=<?php echo time(); ?>" alt="Current Preview">
                <?php endif; ?>
            </div>
        </section>
    <?php endif; ?>
</div>

<script>
function forceUpper(el) {
    if (!el) return;
    const start = el.selectionStart;
    const end = el.selectionEnd;
    el.value = el.value.toUpperCase();
    if (typeof start === 'number' && typeof end === 'number') {
        el.setSelectionRange(start, end);
    }
}

document.addEventListener('input', function(event) {
    if (event.target && ['INPUT', 'TEXTAREA'].includes(event.target.tagName)) {
        if (event.target.type !== 'file') {
            forceUpper(event.target);
        }
    }
});

const gInput = document.getElementById('g_number');
const lookupInput = document.getElementById('lookup_g_number');
let lastLoadedApprovalG = '';

function setFieldValue(id, value) {
    const field = document.getElementById(id);
    if (field) {
        field.value = value ?? '';
    }
}

function refreshApprovalFormFromGNumber(sourceValue = '') {
    const rawValue = sourceValue || (lookupInput && lookupInput.value) || (gInput && gInput.value) || '';
    const g = String(rawValue).replace(/[^0-9]/g, '');

    if (!g) return;

    fetch(window.location.pathname + '?lookup_g=1&g_number=' + encodeURIComponent(g) + '&v=' + Date.now(), {
        cache: 'no-store'
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            alert(data.message || 'No G# found.');
            return;
        }

        const graphic = data.graphic || {};
        const latest = data.latest_revision || {};
        const latestApproval = data.latest_approval_revision || {};

        const loadedG = graphic.g_number || g;
        const isSameLoadedG = lastLoadedApprovalG === loadedG;
        const designField = document.getElementById('design_number');

        setFieldValue('lookup_g_number', loadedG);
        setFieldValue('g_number', loadedG);
        setFieldValue('customer_number', graphic.customer_number || '');
        setFieldValue('customer_name', graphic.customer_name || '');
        setFieldValue('item_description', graphic.part_number || '');

        // D# belongs to approval history, not print card history.
        // Preserve manual D# edits when the same G# refreshes on blur/tab.
        if (designField && (!isSameLoadedG || !designField.value.trim())) {
            designField.value = latestApproval.d_number || '';
        }
        lastLoadedApprovalG = loadedG;

        // Force the Rev field to update every time a G# is loaded.
        const nextRev = String(data.next_approval_rev ?? '0');
        setFieldValue('rev', nextRev);

        const debug = document.getElementById('approvalRevDebug');
        if (debug) {
            debug.textContent = ' Database approval revisions found: ' + String(data.approval_revision_count ?? 0) + ' | Next Rev: ' + nextRev;
        }

        setFieldValue('csr', latestApproval.csr || '');
        setFieldValue('dsr', latestApproval.dsr || '');
        renderApprovalHistory(data.latest_approval_revisions || []);
        updateCreateApprovalStats(graphic.g_number || g, nextRev, (data.latest_approval_revisions || []).length);
    })
    .catch(error => {
        console.error('G# lookup failed:', error);
        alert('G# lookup failed. Check the browser console for details.');
    });
}

document.addEventListener('DOMContentLoaded', function() {
    const lookupForm = document.querySelector('.create-lookup-form');

    if (lookupForm) {
        lookupForm.addEventListener('submit', function(event) {
            event.preventDefault();
            refreshApprovalFormFromGNumber(lookupInput ? lookupInput.value : '');
        });
    }

    if (lookupInput) {
        lookupInput.addEventListener('keydown', function(event) {
            if (event.key === 'Enter') {
                event.preventDefault();
                refreshApprovalFormFromGNumber(lookupInput.value);
            }
        });
    }

    if (gInput) {
        gInput.addEventListener('blur', function() {
            refreshApprovalFormFromGNumber(gInput.value);
        });
    }

    setupArtworkUploadPreview();

    // If page loads with a G# already in either field, force-refresh from DB.
    setTimeout(function() {
        const existingG = (lookupInput && lookupInput.value) || (gInput && gInput.value) || '';
        if (String(existingG).replace(/[^0-9]/g, '')) {
            refreshApprovalFormFromGNumber(existingG);
        }
    }, 150);
});



function escapeHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}

function renderApprovalHistory(rows = []) {
    const list = document.getElementById('approvalHistoryList');
    const historyCountStat = document.getElementById('historyCountStat');
    if (historyCountStat) historyCountStat.textContent = String(rows.length || 0);
    if (!list) return;

    if (!rows.length) {
        list.innerHTML = '<p class="muted approval-history-empty">No approval revision history loaded yet.</p>';
        return;
    }

    list.innerHTML = rows.map(row => `
        <div class="approval-history-row">
            <span><strong>Rev ${escapeHtml(row.rev || '')}</strong></span>
            <span>${escapeHtml(row.rev_date || '')}</span>
            <span>${escapeHtml(row.description || '')}</span>
            <span>CSR: ${escapeHtml(row.csr || '')}</span>
            <span>DSR: ${escapeHtml(row.dsr || '')}</span>
        </div>
    `).join('');
}

function updateCreateApprovalStats(g, nextRev, historyCount) {
    const loadedGStat = document.getElementById('loadedGStat');
    const nextRevStat = document.getElementById('nextRevStat');
    const historyCountStat = document.getElementById('historyCountStat');

    if (loadedGStat) loadedGStat.textContent = g ? 'G#' + String(g).replace(/[^0-9]/g, '') : 'None';
    if (nextRevStat) nextRevStat.textContent = String(nextRev ?? '0');
    if (historyCountStat && typeof historyCount !== 'undefined') historyCountStat.textContent = String(historyCount);
}

function setupArtworkUploadPreview() {
    const fileInput = document.getElementById('approval_art');
    const preview = document.getElementById('artworkUploadPreview');
    if (!fileInput || !preview) return;

    let previewUrl = null;

    fileInput.addEventListener('change', function() {
        const file = fileInput.files && fileInput.files[0];

        if (previewUrl) {
            URL.revokeObjectURL(previewUrl);
            previewUrl = null;
        }

        preview.classList.remove('has-preview');

        if (!file) {
            preview.style.removeProperty('--artwork-preview-ratio');
            preview.innerHTML = '<span>No artwork selected</span>';
            return;
        }

        const safeName = escapeHtml(file.name);

        if (file.type && file.type.startsWith('image/')) {
            const reader = new FileReader();
            reader.onload = function(event) {
                preview.classList.add('has-preview');
                preview.innerHTML = `<img src="${event.target.result}" alt="Selected artwork preview">`;
                const img = preview.querySelector('img');
                if (img) {
                    img.onload = function() {
                        if (img.naturalWidth && img.naturalHeight) {
                            preview.style.setProperty('--artwork-preview-ratio', `${img.naturalWidth} / ${img.naturalHeight}`);
                        }
                    };
                }
            };
            reader.readAsDataURL(file);
            return;
        }

        const isPdf = file.type === 'application/pdf' || file.name.toLowerCase().endsWith('.pdf');
        if (isPdf && window.URL && URL.createObjectURL) {
            previewUrl = URL.createObjectURL(file);
            preview.classList.add('has-preview');
            preview.style.setProperty('--artwork-preview-ratio', '9 / 4');
            const pdfPreviewUrl = `${previewUrl}#toolbar=0&navpanes=0&scrollbar=0&view=Fit&zoom=page-fit`;
            preview.innerHTML = `<iframe src="${pdfPreviewUrl}" title="${safeName}" scrolling="no"></iframe>`;
            return;
        }

        preview.innerHTML = `<span>${safeName}</span>`;
    });
}

function openApprovalPopup() {
    const popup = document.getElementById('approvalPopup');
    if (popup) popup.classList.add('active');
}

function closeApprovalPopup() {
    const popup = document.getElementById('approvalPopup');
    if (popup) popup.classList.remove('active');
}

function printApprovalPopup() {
    const frame = document.getElementById('approvalPopupFrame');
    if (frame && frame.contentWindow) {
        frame.contentWindow.focus();
        frame.contentWindow.print();
    }
}

</script>

</body>
</html>
