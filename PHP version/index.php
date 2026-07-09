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

$printCardMessage = '';
$printCardDownload = '';
$printCardCreated = false;
$vendorArtMessage = '';
$vendorArtMessageType = '';

function cleanNumberOnly($value) {
    return preg_replace('/[^0-9]/', '', $value ?? '');
}

function cleanArtIdentifier($value) {
    $value = strtoupper(trim((string)($value ?? '')));
    $value = preg_replace('/\s+/', '', $value);
    return preg_replace('/[^A-Z0-9#_\-]/', '', $value);
}

function cleanAlphaNumber($value) {
    return strtoupper(preg_replace('/[^A-Z0-9]/i', '', $value ?? ''));
}

function forceUpperText($value) {
    return strtoupper(trim($value ?? ''));
}

function safePath($path) {
    return str_replace(['../', '..\\'], '', $path ?? '');
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
function findPdftkBinaryForIndex() {
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

function normalizePdfFieldName($name) {
    return strtoupper(preg_replace('/[^A-Z0-9]/i', '', (string)$name));
}

function readApprovalPdfFields($pdfWebPath) {
    $pdfWebPath = safePath($pdfWebPath);

    if (
        !$pdfWebPath ||
        !(
            strpos($pdfWebPath, 'approvals/') === 0 ||
            strpos($pdfWebPath, 'approval_revisions_pdfs/') === 0 ||
            strpos($pdfWebPath, 'vendor_approvals/') === 0
        ) ||
        strtolower(pathinfo($pdfWebPath, PATHINFO_EXTENSION)) !== 'pdf'
    ) {
        throw new Exception('Approval PDF path is not valid.');
    }

    $pdfFullPath = __DIR__ . '/' . $pdfWebPath;

    if (!file_exists($pdfFullPath)) {
        throw new Exception('Approval PDF file does not exist.');
    }

    $pdftk = findPdftkBinaryForIndex();

    if (!$pdftk) {
        throw new Exception('pdftk was not found, so approval fields could not be read.');
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

function pickApprovalPdfFieldValue($fields, $possibleNames) {
    $normalized = [];

    foreach ($fields as $name => $value) {
        $normalized[normalizePdfFieldName($name)] = trim((string)$value);
    }

    foreach ($possibleNames as $name) {
        $key = normalizePdfFieldName($name);
        if (array_key_exists($key, $normalized) && $normalized[$key] !== '') {
            return $normalized[$key];
        }
    }

    return '';
}

function extractPrintCardDefaultsFromApprovalPdf($pdfWebPath) {
    $fields = readApprovalPdfFields($pdfWebPath);

    $latestIndex = -1;

    for ($i = 0; $i < 4; $i++) {
        $dateValue = pickApprovalPdfFieldValue($fields, [
            'rev date ' . $i,
            'REV DATE ' . $i,
            'REVDATE' . $i
        ]);

        $descValue = pickApprovalPdfFieldValue($fields, [
            'DESCR ' . $i,
            'DESC ' . $i,
            'DESCRIPTION ' . $i
        ]);

        $csrValue = pickApprovalPdfFieldValue($fields, [
            'CSR ' . $i,
            'CSR' . $i
        ]);

        $desValue = pickApprovalPdfFieldValue($fields, [
            'DSR ' . $i,
            'DSR' . $i,
            'DES ' . $i,
            'DES' . $i
        ]);

        if ($dateValue !== '' || $descValue !== '' || $csrValue !== '' || $desValue !== '') {
            $latestIndex = $i;
        }
    }

    $mapped = [
        'd_number' => pickApprovalPdfFieldValue($fields, [
            'D#',
            'D #',
            'D NUMBER',
            'D NO',
            'DIE #',
            'DIE NUMBER',
            'DIE NO',
            'DIE',
            'DESIGN #',
            'DESIGN NUMBER',
            'DESIGN NO'
        ]),
        // In GM2 print cards, F# is the Approval PDF's Spec #.
        'f_number' => pickApprovalPdfFieldValue($fields, [
            'SPEC #',
            'SPEC#',
            'SPEC',
            'SPEC NUMBER',
            'SPEC NO',
            'ES #',
            'ES#',
            'ES NUMBER',
            'ES NO'
        ]),
        // Approval Rev # should never become the Print Card Rev #.
        // Print Card Rev # is determined only from print_card_revisions.
        'rev' => '',
        'rev_date' => '',
        'description' => '',
        'csr' => '',
        'des' => ''
    ];

    if ($latestIndex >= 0) {
        $mapped['rev_date'] = pickApprovalPdfFieldValue($fields, [
            'rev date ' . $latestIndex,
            'REV DATE ' . $latestIndex,
            'REVDATE' . $latestIndex
        ]);
        $mapped['description'] = pickApprovalPdfFieldValue($fields, [
            'DESCR ' . $latestIndex,
            'DESC ' . $latestIndex,
            'DESCRIPTION ' . $latestIndex
        ]);
        $mapped['csr'] = pickApprovalPdfFieldValue($fields, [
            'CSR ' . $latestIndex,
            'CSR' . $latestIndex
        ]);
        $mapped['des'] = pickApprovalPdfFieldValue($fields, [
            'DSR ' . $latestIndex,
            'DSR' . $latestIndex,
            'DES ' . $latestIndex,
            'DES' . $latestIndex
        ]);
    } else {
        $mapped['rev_date'] = pickApprovalPdfFieldValue($fields, ['REV DATE', 'DATE']);
        $mapped['description'] = pickApprovalPdfFieldValue($fields, ['DESCR', 'DESC', 'DESCRIPTION']);
        $mapped['csr'] = pickApprovalPdfFieldValue($fields, ['CSR']);
        $mapped['des'] = pickApprovalPdfFieldValue($fields, ['DSR', 'DES']);
    }

    foreach ($mapped as $key => $value) {
        $mapped[$key] = strtoupper(trim((string)$value));
    }

    return $mapped;
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

    // If the uploaded approval already contains the selected vendor prefix, keep it clean and consistent.
    if (strpos($raw, $prefix . '#') === 0) {
        return $prefix . '#' . ltrim(substr($raw, strlen($prefix . '#')), '#-_');
    }

    // If the PDF field contains something like G#12345, ART#12345, or another label prefix,
    // use the value after the # and apply the selected vendor prefix instead.
    if (strpos($raw, '#') !== false) {
        $parts = explode('#', $raw, 2);
        $raw = ltrim($parts[1] ?? '', '#-_');
    }

    // If the number starts with the selected prefix but has no #, strip it and rebuild as PREFIX#VALUE.
    if (strpos($raw, $prefix) === 0) {
        $raw = substr($raw, strlen($prefix));
        $raw = ltrim($raw, '#-_');
    }

    return $prefix . '#' . $raw;
}

function extractVendorDefaultsFromApprovalPdf($pdfWebPath) {
    $fields = readApprovalPdfFields($pdfWebPath);

    $mapped = [
        'vendor_raw_number' => pickApprovalPdfFieldValue($fields, [
            'ART #',
            'ART#',
            'ART NUMBER',
            'ART NO',
            'G#',
            'G #',
            'G NUMBER',
            'G NO',
            'GRAPHICS #',
            'GRAPHICS NUMBER',
            'GRAPHIC #',
            'GRAPHIC NUMBER'
        ]),
        'customer_number' => pickApprovalPdfFieldValue($fields, [
            'CUSTOMER #',
            'CUSTOMER#',
            'CUSTOMER NUMBER',
            'CUSTOMER NO',
            'CUSTOMER ID',
            'CUSTOMER CODE',
            'CUSTOMER ACCOUNT',
            'CUST #',
            'CUST#',
            'CUST NUMBER',
            'CUST NO',
            'CUST ID',
            'CUST CODE',
            'ACCT #',
            'ACCOUNT #',
            'ACCOUNT NUMBER'
        ]),
        'customer_name' => pickApprovalPdfFieldValue($fields, [
            'CUSTOMER',
            'CUSTOMER NAME',
            'CUST NAME',
            'CLIENT',
            'CLIENT NAME',
            'COMPANY',
            'COMPANY NAME'
        ]),
        'part_number' => pickApprovalPdfFieldValue($fields, [
            'PART #',
            'PART#',
            'PART NUMBER',
            'PART NO',
            'PART DESCRIPTION',
            'PART DESC',
            'ITEM #',
            'ITEM#',
            'ITEM NUMBER',
            'ITEM NO',
            'ITEM DESCRIPTION',
            'ITEM DESC',
            'ITEM',
            'DESCRIPTION',
            'PRODUCT DESCRIPTION',
            'PRODUCT DESC',
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


function buildRevisionedGNumberForPrintCard($gNumber, $rev) {
    $artId = cleanArtIdentifier($gNumber);
    $cleanRev = strtoupper(trim((string)($rev ?? '')));

    if ($artId === '') {
        return '';
    }

    if ($cleanRev === '' || $cleanRev === '0') {
        return $artId;
    }

    if (preg_match('/-' . preg_quote($cleanRev, '/') . '$/i', $artId)) {
        return $artId;
    }

    return $artId . '-' . $cleanRev;
}

function formatPrintCardArtIdentifier($artIdentifier, $rev) {
    $artIdentifier = cleanArtIdentifier($artIdentifier);
    $baseInternalG = getBaseInternalGNumberForPrintCard($artIdentifier);
    $displayBase = $baseInternalG !== '' ? $baseInternalG : $artIdentifier;
    $revisioned = buildRevisionedGNumberForPrintCard($displayBase, $rev);

    if ($revisioned === '') {
        return '';
    }

    if ($baseInternalG !== '') {
        return 'G#' . $revisioned;
    }

    return $revisioned;
}

if (isset($_GET['created_print_card']) && isset($_GET['created_f'])) {
    $createdPath = safePath($_GET['created_print_card']);
    $createdF = cleanNumberOnly($_GET['created_f']);

    if ($createdPath && $createdF && file_exists(__DIR__ . '/' . $createdPath)) {
        $printCardCreated = true;
        $printCardDownload = $createdPath;
        $printCardMessage = 'Print card created: ' . htmlspecialchars($createdF) . '.jpg';
    }
}

function getLatestPrintCardForG($db, $gNumber, $fNumber = '') {
    $artId = cleanArtIdentifier($gNumber);
    $fNumber = cleanNumberOnly($fNumber);

    if ($artId === '') {
        return null;
    }

    // Internal G# records can arrive as G#12874, 12874, G#12874-1, or 12874-1.
    // Match by the base number before any revision suffix so existing print cards stay connected.
    $baseArtId = preg_replace('/-.*/', '', $artId);
    $internalBase = '';

    if (preg_match('/^(G#|#)?[0-9]+$/', $baseArtId)) {
        $internalBase = cleanNumberOnly($baseArtId);
    }

    $fFilter = $fNumber !== '' ? ' AND f_number = :f_number ' : '';

    if ($internalBase !== '') {
        $stmt = $db->prepare("
            SELECT f_number, d_number, csr, des, rev
            FROM print_card_revisions
            WHERE
                REPLACE(
                    REPLACE(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END,
                    'G#', ''),
                '#', '') = :g_number
                $fFilter
            ORDER BY 
                CASE 
                    WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER)
                    ELSE -1
                END DESC,
                id DESC
            LIMIT 1
        ");
        $stmt->bindValue(':g_number', $internalBase);
    } else {
        $stmt = $db->prepare("
            SELECT f_number, d_number, csr, des, rev
            FROM print_card_revisions
            WHERE (
                UPPER(g_number) = :g_number
                OR UPPER(
                    CASE
                        WHEN INSTR(g_number, '-') > 0
                        THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                        ELSE g_number
                    END
                ) = :g_number
            )
            $fFilter
            ORDER BY 
                CASE 
                    WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER)
                    ELSE -1
                END DESC,
                id DESC
            LIMIT 1
        ");
        $stmt->bindValue(':g_number', strtoupper($artId));
    }

    if ($fNumber !== '') {
        $stmt->bindValue(':f_number', $fNumber);
    }

    $result = $stmt->execute();
    $row = $result->fetchArray(SQLITE3_ASSOC);

    if (!$row || empty($row['f_number'])) {
        return null;
    }

    $foundFNumber = preg_replace('/[^0-9]/', '', $row['f_number']);

    if ($foundFNumber === '') {
        return null;
    }

    $latestRev = strtoupper(trim($row['rev'] ?? '0'));

    if (is_numeric($latestRev)) {
        $nextRev = (string)((int)$latestRev + 1);
    } else {
        $nextRev = $latestRev;
    }

    return [
        'f_number' => $foundFNumber,
        'd_number' => strtoupper(trim($row['d_number'] ?? '')),
        'csr' => strtoupper(trim($row['csr'] ?? '')),
        'des' => strtoupper(trim($row['des'] ?? '')),
        'next_rev' => $nextRev,
        'web_path' => 'print_cards/' . $foundFNumber . '.jpg'
    ];
}



if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'add_vendor_art') {
    try {
        $vendorOptions = getVendorOptions();
        $vendorName = trim((string)($_POST['vendor_name'] ?? ''));
        $vendorPrefix = $vendorOptions[$vendorName] ?? '';

        if ($vendorPrefix === '') {
            throw new Exception('Please select a valid vendor.');
        }

        if (!isset($_FILES['vendor_approval_pdf']) || ($_FILES['vendor_approval_pdf']['error'] ?? UPLOAD_ERR_NO_FILE) !== UPLOAD_ERR_OK) {
            throw new Exception('Please upload the vendor approval PDF.');
        }

        $uploadedName = $_FILES['vendor_approval_pdf']['name'] ?? '';
        $uploadedExt = strtolower(pathinfo($uploadedName, PATHINFO_EXTENSION));

        if ($uploadedExt !== 'pdf') {
            throw new Exception('Vendor approval must be a PDF.');
        }

        $vendorDir = __DIR__ . '/vendor_approvals';
        if (!is_dir($vendorDir)) {
            mkdir($vendorDir, 0777, true);
        }
        @chmod($vendorDir, 0777);

        $tempPdfName = 'vendor_upload_' . time() . '_' . mt_rand(1000, 9999) . '.pdf';
        $tempPdfFull = $vendorDir . '/' . $tempPdfName;

        if (!move_uploaded_file($_FILES['vendor_approval_pdf']['tmp_name'], $tempPdfFull)) {
            throw new Exception('Could not save the uploaded vendor approval PDF.');
        }

        $tempPdfWeb = 'vendor_approvals/' . $tempPdfName;
        $defaults = extractVendorDefaultsFromApprovalPdf($tempPdfWeb);

        $manualVendorRaw = cleanVendorRawNumber($_POST['vendor_raw_number'] ?? '');
        $vendorRawNumber = $manualVendorRaw !== '' ? $manualVendorRaw : cleanVendorRawNumber($defaults['vendor_raw_number'] ?? '');
        $vendorArtNumber = buildVendorArtNumber($vendorPrefix, $vendorRawNumber);

        if ($vendorArtNumber === '') {
            @unlink($tempPdfFull);
            throw new Exception('The vendor art number could not be found. Make sure the vendor number is in the approval PDF G# / ART # field, or type it manually.');
        }

        $safeVendorFileBase = preg_replace('/[^A-Z0-9_-]/', '_', str_replace('#', '_', $vendorArtNumber));
        $finalPdfName = $safeVendorFileBase . '_APPROVAL_' . time() . '.pdf';
        $finalPdfFull = $vendorDir . '/' . $finalPdfName;
        $finalPdfWeb = 'vendor_approvals/' . $finalPdfName;

        if (!rename($tempPdfFull, $finalPdfFull)) {
            @unlink($tempPdfFull);
            throw new Exception('Could not finalize the vendor approval PDF.');
        }

        $customerNumber = forceUpperText($_POST['vendor_customer_number'] ?? '') ?: forceUpperText($defaults['customer_number'] ?? '');
        $customerName = forceUpperText($_POST['vendor_customer_name'] ?? '') ?: forceUpperText($defaults['customer_name'] ?? '');
        $partNumber = forceUpperText($_POST['vendor_part_number'] ?? '') ?: forceUpperText($defaults['part_number'] ?? '');

        $stmt = $db->prepare("
            INSERT OR REPLACE INTO vendor_art
            (vendor_name, vendor_prefix, vendor_raw_number, vendor_art_number, customer_number, customer_name, part_number, preview_image)
            VALUES
            (:vendor_name, :vendor_prefix, :vendor_raw_number, :vendor_art_number, :customer_number, :customer_name, :part_number, :preview_image)
        ");
        $stmt->bindValue(':vendor_name', $vendorName);
        $stmt->bindValue(':vendor_prefix', $vendorPrefix);
        $stmt->bindValue(':vendor_raw_number', $vendorRawNumber);
        $stmt->bindValue(':vendor_art_number', $vendorArtNumber);
        $stmt->bindValue(':customer_number', $customerNumber);
        $stmt->bindValue(':customer_name', $customerName);
        $stmt->bindValue(':part_number', $partNumber);
        $stmt->bindValue(':preview_image', $finalPdfWeb);
        $stmt->execute();

        $vendorArtMessage = 'Vendor approval added for ' . htmlspecialchars($vendorArtNumber) . '.';
        $vendorArtMessageType = 'success';
    } catch (Exception $e) {
        $vendorArtMessage = htmlspecialchars($e->getMessage());
        $vendorArtMessageType = 'error';
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
        $latest = getLatestPrintCardForG($db, $row['g_number']);
        $approvalPreview = getLatestApprovalPreviewForG($db, $row['g_number'], $row['preview_image'] ?? '');

        $rows[] = [
            'g_number' => $row['g_number'] ?? '',
            'customer_number' => $row['customer_number'] ?? '',
            'customer_name' => $row['customer_name'] ?? '',
            'part_number' => $row['part_number'] ?? '',
            'preview_image' => $approvalPreview,
            'latest_print_card' => $latest
        ];
    }

    echo json_encode($rows);
    exit;
}

function getLatestApprovalPreviewForG($db, $gNumber, $fallbackPreview = '') {
    $cleanG = cleanNumberOnly($gNumber);
    $fallbackPreview = safePath($fallbackPreview);

    if ($cleanG === '') {
        return '';
    }

    $fallbackExists = (
        $fallbackPreview &&
        (
            strpos($fallbackPreview, 'approvals/') === 0 ||
            strpos($fallbackPreview, 'approval_revisions_pdfs/') === 0 ||
            strpos($fallbackPreview, 'uploads/') === 0 ||
            strpos($fallbackPreview, 'vendor_approvals/') === 0
        ) &&
        file_exists(__DIR__ . '/' . $fallbackPreview)
    );

    if (
        $fallbackExists &&
        (
            strpos($fallbackPreview, 'approvals/') === 0 ||
            strpos($fallbackPreview, 'approval_revisions_pdfs/') === 0
        ) &&
        strtolower(pathinfo($fallbackPreview, PATHINFO_EXTENSION)) === 'pdf'
    ) {
        return $fallbackPreview;
    }

    $stmt = $db->prepare("
        SELECT approval_pdf
        FROM approval_revisions
        WHERE
                REPLACE(
                    REPLACE(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END,
                    'G#', ''),
                '#', '') = :g_number
          AND approval_pdf IS NOT NULL
          AND approval_pdf != ''
        ORDER BY
            CASE
                WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER)
                ELSE -1
            END DESC,
            id DESC
        LIMIT 1
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

    $latestApproval = safePath($row['approval_pdf'] ?? '');

    if (
        $latestApproval &&
        (
            strpos($latestApproval, 'approvals/') === 0 ||
            strpos($latestApproval, 'approval_revisions_pdfs/') === 0
        ) &&
        strtolower(pathinfo($latestApproval, PATHINFO_EXTENSION)) === 'pdf' &&
        file_exists(__DIR__ . '/' . $latestApproval)
    ) {
        $update = $db->prepare("
            UPDATE graphics
            SET preview_image = :preview_image
            WHERE
                REPLACE(
                    REPLACE(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END,
                    'G#', ''),
                '#', '') = :g_number
        ");
        $update->bindValue(':preview_image', $latestApproval);
        $update->bindValue(':g_number', $cleanG);
        $update->execute();
        return $latestApproval;
    }

    if ($latestApproval && !file_exists(__DIR__ . '/' . $latestApproval)) {
        $clearMissingApproval = $db->prepare("
            UPDATE approval_revisions
            SET approval_pdf = ''
            WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
              AND approval_pdf = :approval_pdf
        ");
        $clearMissingApproval->bindValue(':g_number', $cleanG);
        $clearMissingApproval->bindValue(':approval_pdf', $latestApproval);
        $clearMissingApproval->execute();
    }

    if (!$fallbackExists && $fallbackPreview) {
        $clearMissingPreview = $db->prepare("
            UPDATE graphics
            SET preview_image = NULL
            WHERE
                REPLACE(
                    REPLACE(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END,
                    'G#', ''),
                '#', '') = :g_number
              AND preview_image = :preview_image
        ");
        $clearMissingPreview->bindValue(':g_number', $cleanG);
        $clearMissingPreview->bindValue(':preview_image', $fallbackPreview);
        $clearMissingPreview->execute();

        return '';
    }

    return $fallbackExists ? $fallbackPreview : '';
}


if (isset($_GET['approval_fields']) && $_GET['approval_fields'] === '1') {
    header('Content-Type: application/json');

    try {
        $pdf = safePath($_GET['pdf'] ?? '');

        if ($pdf === '') {
            throw new Exception('Missing approval PDF path.');
        }

        $defaults = extractPrintCardDefaultsFromApprovalPdf($pdf);

        echo json_encode([
            'success' => true,
            'fields' => $defaults
        ]);
    } catch (Exception $e) {
        echo json_encode([
            'success' => false,
            'message' => $e->getMessage()
        ]);
    }

    exit;
}


if (isset($_GET['print_card_defaults']) && $_GET['print_card_defaults'] === '1') {
    header('Content-Type: application/json');

    try {
        $gNumber = cleanArtIdentifier($_GET['g_number'] ?? '');
        $fNumber = cleanNumberOnly($_GET['f_number'] ?? '');

        if ($gNumber === '') {
            throw new Exception('Missing Art #.');
        }

        $latest = getLatestPrintCardForG($db, $gNumber, $fNumber);

        echo json_encode([
            'success' => true,
            'latest_print_card' => $latest,
            'next_rev' => $latest['next_rev'] ?? '0'
        ]);
    } catch (Exception $e) {
        echo json_encode([
            'success' => false,
            'message' => $e->getMessage()
        ]);
    }

    exit;
}

if (isset($_GET['latest_approval']) && $_GET['latest_approval'] === '1') {
    header('Content-Type: application/json');

    try {
        $gNumber = cleanNumberOnly($_GET['g_number'] ?? '');

        if ($gNumber === '') {
            throw new Exception('Missing G#.');
        }

        $stmt = $db->prepare("
            SELECT preview_image
            FROM graphics
            WHERE
                REPLACE(
                    REPLACE(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END,
                    'G#', ''),
                '#', '') = :g_number
            LIMIT 1
        ");
        $stmt->bindValue(':g_number', $gNumber);
        $graphic = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

        $preview = getLatestApprovalPreviewForG($db, $gNumber, $graphic['preview_image'] ?? '');

        if (!$preview) {
            throw new Exception('No approval PDF found for G#' . $gNumber . '.');
        }

        echo json_encode([
            'success' => true,
            'g_number' => $gNumber,
            'preview_image' => $preview,
            'version' => time()
        ]);
    } catch (Exception $e) {
        echo json_encode([
            'success' => false,
            'message' => $e->getMessage()
        ]);
    }

    exit;
}

if (isset($_GET['approval_compare']) && $_GET['approval_compare'] === '1') {
    header('Content-Type: application/json');

    try {
        $gNumber = cleanNumberOnly($_GET['g_number'] ?? '');

        if ($gNumber === '') {
            throw new Exception('Missing G#.');
        }

        $graphicStmt = $db->prepare("
            SELECT g_number, customer_number, customer_name, part_number, preview_image
            FROM graphics
            WHERE
                REPLACE(
                    REPLACE(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END,
                    'G#', ''),
                '#', '') = :g_number
            LIMIT 1
        ");
        $graphicStmt->bindValue(':g_number', $gNumber);
        $graphic = $graphicStmt->execute()->fetchArray(SQLITE3_ASSOC);

        if (!$graphic) {
            throw new Exception('No G# found.');
        }

        $currentApprovalPreview = getLatestApprovalPreviewForG($db, $gNumber, $graphic['preview_image'] ?? '');

        $revStmt = $db->prepare("
            SELECT id, rev, rev_date, description, csr, dsr, snapshot_image, approval_pdf, created_at
            FROM approval_revisions
            WHERE
                REPLACE(
                    REPLACE(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END,
                    'G#', ''),
                '#', '') = :g_number
            ORDER BY 
                CASE 
                    WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER)
                    ELSE 9999
                END ASC,
                rev ASC,
                id ASC
        ");
        $revStmt->bindValue(':g_number', $gNumber);
        $revResult = $revStmt->execute();

        $revisions = [];
        while ($row = $revResult->fetchArray(SQLITE3_ASSOC)) {
            $snapshot = safePath($row['snapshot_image'] ?? '');
            if ($snapshot && strpos($snapshot, 'approval_snapshots/') === 0 && file_exists(__DIR__ . '/' . $snapshot)) {
                $revisions[] = [
                    'id' => intval($row['id'] ?? 0),
                    'rev' => $row['rev'] ?? '',
                    'rev_date' => $row['rev_date'] ?? '',
                    'description' => $row['description'] ?? '',
                    'csr' => $row['csr'] ?? '',
                    'dsr' => $row['dsr'] ?? '',
                    'snapshot_image' => $snapshot,
                    'created_at' => $row['created_at'] ?? ''
                ];
            }
        }

        echo json_encode([
            'success' => true,
            'graphic' => [
                'g_number' => cleanNumberOnly($graphic['g_number'] ?? $gNumber),
                'customer_number' => $graphic['customer_number'] ?? '',
                'customer_name' => $graphic['customer_name'] ?? '',
                'part_number' => $graphic['part_number'] ?? '',
                'current_pdf' => $currentApprovalPreview
            ],
            'revisions' => $revisions
        ]);
    } catch (Exception $e) {
        echo json_encode([
            'success' => false,
            'message' => $e->getMessage()
        ]);
    }

    exit;
}



function getBaseInternalGNumberForPrintCard($artIdentifier) {
    $artIdentifier = cleanArtIdentifier($artIdentifier);
    $artIdentifier = str_replace('G#', '', $artIdentifier);
    $artIdentifier = ltrim($artIdentifier, '#');

    if (preg_match('/^(\d+)(?:-[A-Z0-9]+)?$/i', $artIdentifier, $matches)) {
        return $matches[1];
    }

    return '';
}

function getLatestApprovalRevisionForPrintCard($db, $gNumber) {
    $baseG = getBaseInternalGNumberForPrintCard($gNumber);

    if ($baseG === '') {
        return '';
    }

    $stmt = $db->prepare("
        SELECT rev
        FROM approval_revisions
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
          AND rev IS NOT NULL
          AND rev != ''
        ORDER BY
            CASE
                WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER)
                ELSE 9999
            END DESC,
            id DESC
        LIMIT 1
    ");
    $stmt->bindValue(':g_number', $baseG);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

    return strtoupper(trim((string)($row['rev'] ?? '')));
}

function findSystemFont($bold = false) {
    $fontCandidates = $bold ? [
        '/System/Library/Fonts/Supplemental/Arial Bold.ttf',
        '/Library/Fonts/Arial Bold.ttf',
        '/System/Library/Fonts/Supplemental/Helvetica Bold.ttf',
        '/System/Library/Fonts/Supplemental/Arial.ttf'
    ] : [
        '/System/Library/Fonts/Supplemental/Arial.ttf',
        '/Library/Fonts/Arial.ttf',
        '/System/Library/Fonts/Supplemental/Helvetica.ttf'
    ];

    foreach ($fontCandidates as $font) {
        if (file_exists($font)) {
            return $font;
        }
    }

    return null;
}

function drawPrintCardText($img, $text, $x, $y, $size, $color, $font = null) {
    $text = (string)$text;

    if ($font && function_exists('imagettftext')) {
        imagettftext($img, $size, 0, $x, $y, $color, $font, $text);
    } else {
        $gdSize = max(1, min(5, intval(round($size / 4))));
        imagestring($img, $gdSize, $x, $y - 12, $text, $color);
    }
}

function wrapPrintCardText($text, $font, $size, $maxWidth) {
    $text = trim((string)$text);
    if ($text === '') {
        return [];
    }

    $words = preg_split('/\s+/', $text);
    $lines = [];
    $line = '';

    foreach ($words as $word) {
        $test = trim($line . ' ' . $word);

        if ($font && function_exists('imagettfbbox')) {
            $box = imagettfbbox($size, 0, $font, $test);
            $width = abs($box[2] - $box[0]);
        } else {
            $width = strlen($test) * 7;
        }

        if ($width > $maxWidth && $line !== '') {
            $lines[] = $line;
            $line = $word;
        } else {
            $line = $test;
        }
    }

    if ($line !== '') {
        $lines[] = $line;
    }

    return $lines;
}


function getLatestFourRevisionsForPrintCard($db, $fNumber = '', $gNumber = '') {
    $fNumber = cleanNumberOnly($fNumber);
    $artId = cleanArtIdentifier($gNumber);

    if ($fNumber !== '') {
        $stmt = $db->prepare("
            SELECT * FROM print_card_revisions
            WHERE f_number = :f_number
        ");
        $stmt->bindValue(':f_number', $fNumber);
    } else {
        $baseArtId = preg_replace('/-.*/', '', $artId);
        $internalBase = '';

        if (preg_match('/^(G#|#)?[0-9]+$/', $baseArtId)) {
            $internalBase = cleanNumberOnly($baseArtId);
        }

        if ($internalBase !== '') {
            $stmt = $db->prepare("
                SELECT * FROM print_card_revisions
                WHERE
                    REPLACE(
                        REPLACE(
                            CASE
                                WHEN INSTR(g_number, '-') > 0
                                THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                                ELSE g_number
                            END,
                        'G#', ''),
                    '#', '') = :g_number
            ");
            $stmt->bindValue(':g_number', $internalBase);
        } else {
            $stmt = $db->prepare("
                SELECT * FROM print_card_revisions
                WHERE UPPER(g_number) = :g_number
                   OR UPPER(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END
                      ) = :g_number
            ");
            $stmt->bindValue(':g_number', strtoupper($artId));
        }
    }

    $result = $stmt->execute();
    $all = [];

    while ($row = $result->fetchArray(SQLITE3_ASSOC)) {
        $revRaw = strtoupper(trim((string)($row['rev'] ?? '')));

        // Numeric revs sort numerically. Non-numeric revs sort after numeric revs.
        if (preg_match('/^\d+$/', $revRaw)) {
            $sortType = 0;
            $sortNumber = intval($revRaw);
            $sortText = '';
        } else {
            $sortType = 1;
            $sortNumber = 999999;
            $sortText = $revRaw;
        }

        $row['_sort_type'] = $sortType;
        $row['_sort_number'] = $sortNumber;
        $row['_sort_text'] = $sortText;
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

    // Keep the latest/highest 4 revisions, but preserve ascending display order.
    $selected = array_slice($all, -4);

    foreach ($selected as &$row) {
        unset($row['_sort_type'], $row['_sort_number'], $row['_sort_text'], $row['_sort_id']);
    }

    return $selected;
}


function createInfoBlockWithGD($db, $tempInfoPath, $infoW, $cardH, $fNumber, $dNumber, $gNumber, $revisions) {
    if (!function_exists('imagecreatetruecolor')) {
        throw new Exception("PHP GD is not enabled. Enable GD in XAMPP php.ini.");
    }

    /*
        Minimal production-style info strip:
        - 1" wide final strip
        - rotated revision table
        - F#/D#/G# stay horizontal underneath
        - black/white only
    */

    $white = imagecolorallocate(imagecreatetruecolor(1, 1), 255, 255, 255);

    $final = imagecreatetruecolor($infoW, $cardH);
    $whiteFinal = imagecolorallocate($final, 255, 255, 255);
    $blackFinal = imagecolorallocate($final, 0, 0, 0);
    imagefilledrectangle($final, 0, 0, $infoW, $cardH, $whiteFinal);

    $font = findSystemFont(false);
    $fontBold = findSystemFont(true) ?: $font;

    // No outer border around the full info strip.
    // The revision table keeps its own border/grid.

    /*
        Build table horizontally first, then rotate it.
        After rotation, it fits into the top portion of the 1" strip.
    */
    $tableBaseW = 1000;
    $tableBaseH = 250;

    $tableBase = imagecreatetruecolor($tableBaseW, $tableBaseH);
    $white = imagecolorallocate($tableBase, 255, 255, 255);
    $black = imagecolorallocate($tableBase, 0, 0, 0);
    imagefilledrectangle($tableBase, 0, 0, $tableBaseW, $tableBaseH, $white);

    $x = 10;
    $y = 10;
    $tableW = 980;
    $headerH = 42;
    $rowH = 48;
    $tableH = $headerH + ($rowH * 4);

    // Column widths
    $colRev = 75;
    $colDate = 155;
    $colDesc = 500;
    $colApp = 125;
    $colDes = 125;

    $colX = [
        $x,
        $x + $colRev,
        $x + $colRev + $colDate,
        $x + $colRev + $colDate + $colDesc,
        $x + $colRev + $colDate + $colDesc + $colApp,
        $x + $tableW
    ];

    // Draw table
    imagesetthickness($tableBase, 2);
    imagerectangle($tableBase, $x, $y, $x + $tableW, $y + $tableH, $black);

    for ($i = 1; $i < count($colX) - 1; $i++) {
        imageline($tableBase, $colX[$i], $y, $colX[$i], $y + $tableH, $black);
    }

    imageline($tableBase, $x, $y + $headerH, $x + $tableW, $y + $headerH, $black);

    for ($i = 1; $i <= 4; $i++) {
        $lineY = $y + $headerH + ($rowH * $i);
        imageline($tableBase, $x, $lineY, $x + $tableW, $lineY, $black);
    }

    // Headers
    drawPrintCardText($tableBase, 'REV', $x + 16, $y + 29, 15, $black, $fontBold);
    drawPrintCardText($tableBase, 'DATE', $colX[1] + 28, $y + 29, 15, $black, $fontBold);
    drawPrintCardText($tableBase, 'DESCRIPTION', $colX[2] + 180, $y + 29, 15, $black, $fontBold);
    drawPrintCardText($tableBase, 'CSR', $colX[3] + 38, $y + 29, 15, $black, $fontBold);
    drawPrintCardText($tableBase, 'DES', $colX[4] + 38, $y + 29, 15, $black, $fontBold);

    // Rows
    for ($i = 0; $i < 4; $i++) {
        $row = $revisions[$i] ?? [];

        $rev = strtoupper(trim((string)($row['rev'] ?? '')));
        $date = strtoupper(trim((string)($row['rev_date'] ?? '')));
        $desc = strtoupper(trim((string)($row['description'] ?? '')));
        $csr = strtoupper(trim((string)($row['csr'] ?? '')));
        $des = strtoupper(trim((string)($row['des'] ?? '')));

        $textY = $y + $headerH + ($rowH * $i) + 32;

        drawPrintCardText($tableBase, $rev, $x + 28, $textY, 22, $black, $font);
        drawPrintCardText($tableBase, $date, $colX[1] + 15, $textY, 22, $black, $font);

        $descLines = wrapPrintCardText($desc, $font, 22, $colDesc - 20);
        $descText = $descLines[0] ?? '';
        drawPrintCardText($tableBase, $descText, $colX[2] + 12, $textY, 22, $black, $font);

        drawPrintCardText($tableBase, $csr, $colX[3] + 42, $textY, 22, $black, $font);
        drawPrintCardText($tableBase, $des, $colX[4] + 42, $textY, 22, $black, $font);
    }

    // Rotate opposite direction from prior version.
    $rotated = imagerotate($tableBase, -90, $white);

    // Place rotated table in the top area.
    // Center the rotated table horizontally within the 1" strip.
    $tableAreaW = $infoW - 44;
    $tableAreaH = 810;

    $tableAreaX = intval(($infoW - $tableAreaW) / 2);
    $tableAreaY = 210;

    imagecopyresampled(
        $final,
        $rotated,
        $tableAreaX,
        $tableAreaY,
        0,
        0,
        $tableAreaW,
        $tableAreaH,
        imagesx($rotated),
        imagesy($rotated)
    );

    // F#/D#/G# stay horizontal near the bottom of the print card.
    $idX = 28;

    // Push identifiers toward the bottom while keeping safe print margin.
    $idY = $cardH - 155;

    $latestRevisionRow = !empty($revisions) ? $revisions[count($revisions) - 1] : [];
    $latestPrintCardRev = $latestRevisionRow['rev'] ?? '';
    $displayArtIdentifier = formatPrintCardArtIdentifier($gNumber, $latestPrintCardRev);

    drawPrintCardText($final, 'F#' . (string)$fNumber, $idX, $idY, 24, $blackFinal, $font);
    drawPrintCardText($final, 'D#' . (string)$dNumber, $idX, $idY + 40, 24, $blackFinal, $font);
    drawPrintCardText($final, $displayArtIdentifier, $idX, $idY + 80, 24, $blackFinal, $font);
    
    imagejpeg($final, $tempInfoPath, 95);

    imagedestroy($tableBase);
    imagedestroy($rotated);
    imagedestroy($final);

    if (!file_exists($tempInfoPath)) {
        throw new Exception("GD info block was not created.");
    }
}

function regeneratePrintCardFromExistingJpg($db, $fNumber) {
    $fNumber = cleanNumberOnly($fNumber);

    if ($fNumber === '') {
        throw new Exception("Missing F#.");
    }

    $output_dir = __DIR__ . '/print_cards';
    $existing_file = $output_dir . '/' . $fNumber . '.jpg';

    if (!file_exists($existing_file)) {
        throw new Exception("Existing print card JPG not found for F# " . $fNumber . ".");
    }

    $revisions = getLatestFourRevisionsForPrintCard($db, $fNumber, '');

    if (empty($revisions)) {
        throw new Exception("No revision records found for F# " . $fNumber . ".");
    }

    $latest = end($revisions);

    $gNumber = cleanArtIdentifier($latest['g_number'] ?? '');
    $dNumber = cleanAlphaNumber($latest['d_number'] ?? '');

    $magick = '/usr/local/bin/magick';

    if (!file_exists($magick)) {
        throw new Exception("ImageMagick not found at /usr/local/bin/magick.");
    }

    $magick_tmp = __DIR__ . '/magick_tmp';
    if (!is_dir($magick_tmp)) {
        mkdir($magick_tmp, 0777, true);
    }

    @chmod($magick_tmp, 0777);
    @chmod($output_dir, 0777);

    $magick_env =
        'PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
        'MAGICK_TEMPORARY_PATH=' . escapeshellarg($magick_tmp) . ' ' .
        'TMPDIR=' . escapeshellarg($magick_tmp) . ' ';

    // Must match the print-card generation dimensions.
    $card_w = 3000;
    $card_h = 1200;
    $info_w = 300;
    $art_w = $card_w - $info_w;

    $temp_art = $output_dir . '/refresh_art_' . $fNumber . '_' . time() . '.jpg';
    $temp_info = $output_dir . '/refresh_info_' . $fNumber . '_' . time() . '.jpg';
    $temp_final = $output_dir . '/refresh_final_' . $fNumber . '_' . time() . '.jpg';

    // Pull the existing artwork area from the current print card.
    // This preserves the artwork/PDF portion and only rebuilds the right-side info block.
    $cmd1 = $magick_env . escapeshellcmd($magick) .
        ' ' . escapeshellarg($existing_file) .
        ' -crop ' . $art_w . 'x' . $card_h . '+0+0' .
        ' +repage ' .
        ' -resize ' . $art_w . 'x' . $card_h . '!' .
        ' ' . escapeshellarg($temp_art) . ' 2>&1';

    exec($cmd1, $out1, $ret1);

    if ($ret1 !== 0 || !file_exists($temp_art)) {
        throw new Exception("Could not extract existing artwork area: " . implode("\\n", $out1));
    }

    createInfoBlockWithGD($db, $temp_info, $info_w, $card_h, $fNumber, $dNumber, $gNumber, $revisions);

    $cmd2 = $magick_env . escapeshellcmd($magick) .
        ' ' . escapeshellarg($temp_art) .
        ' ' . escapeshellarg($temp_info) .
        ' +append -quality 95 ' .
        escapeshellarg($temp_final) . ' 2>&1';

    exec($cmd2, $out2, $ret2);

    if ($ret2 !== 0 || !file_exists($temp_final)) {
        throw new Exception("Could not rebuild print card: " . implode("\\n", $out2));
    }

    if (!rename($temp_final, $existing_file)) {
        throw new Exception("Could not replace existing print card JPG.");
    }

    @unlink($temp_art);
    @unlink($temp_info);

    return 'print_cards/' . $fNumber . '.jpg';
}


if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'delete_approval_preview') {
    header('Content-Type: application/json');

    try {
        $gNumber = cleanNumberOnly($_POST['g_number'] ?? '');

        if ($gNumber === '') {
            throw new Exception("Missing G#.");
        }

        $stmt = $db->prepare("
            SELECT preview_image
            FROM graphics
            WHERE
                REPLACE(
                    REPLACE(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END,
                    'G#', ''),
                '#', '') = :g_number
            LIMIT 1
        ");
        $stmt->bindValue(':g_number', $gNumber);
        $result = $stmt->execute();
        $row = $result->fetchArray(SQLITE3_ASSOC);

        if (!$row || empty($row['preview_image'])) {
            throw new Exception("No approval preview was found for G#" . $gNumber . ".");
        }

        $previewPath = safePath($row['preview_image']);
        $fullPath = __DIR__ . '/' . $previewPath;

        // Only delete files created by the approval creator.
        // This prevents accidentally deleting older imported previews or production artwork.
        if (strpos($previewPath, 'approvals/') !== 0) {
            throw new Exception("This preview is not in the approvals folder, so it was not deleted.");
        }

        if (file_exists($fullPath)) {
            @unlink($fullPath);
        }

        // Delete the matching generated PDF too, if it exists.
        $pdfFullPath = preg_replace('/\.(jpg|jpeg|png)$/i', '.pdf', $fullPath);
        if ($pdfFullPath && $pdfFullPath !== $fullPath && file_exists($pdfFullPath)) {
            @unlink($pdfFullPath);
        }

        $update = $db->prepare("
            UPDATE graphics
            SET preview_image = NULL
            WHERE
                REPLACE(
                    REPLACE(
                        CASE
                            WHEN INSTR(g_number, '-') > 0
                            THEN SUBSTR(g_number, 1, INSTR(g_number, '-') - 1)
                            ELSE g_number
                        END,
                    'G#', ''),
                '#', '') = :g_number
        ");
        $update->bindValue(':g_number', $gNumber);
        $update->execute();

        echo json_encode([
            'success' => true,
            'message' => 'Approval removed from G#' . $gNumber . ' and file deleted.'
        ]);
    } catch (Exception $e) {
        echo json_encode([
            'success' => false,
            'message' => $e->getMessage()
        ]);
    }

    exit;
}


function getLatestPrintCardRevisionDetailsForIndex($db, $fNumber) {
    $fNumber = cleanNumberOnly($fNumber);

    if ($fNumber === '') {
        return null;
    }

    $stmt = $db->prepare("
        SELECT id, g_number, f_number, d_number, rev, rev_date, description, csr, des, created_at
        FROM print_card_revisions
        WHERE f_number = :f_number
        ORDER BY
            CASE
                WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER)
                ELSE 9999
            END DESC,
            rev DESC,
            id DESC
        LIMIT 1
    ");
    $stmt->bindValue(':f_number', $fNumber);
    $row = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

    if (!$row) {
        return null;
    }

    return [
        'id' => intval($row['id'] ?? 0),
        'g_number' => $row['g_number'] ?? '',
        'f_number' => $row['f_number'] ?? '',
        'd_number' => $row['d_number'] ?? '',
        'rev' => $row['rev'] ?? '',
        'rev_date' => $row['rev_date'] ?? '',
        'description' => $row['description'] ?? '',
        'csr' => $row['csr'] ?? '',
        'des' => $row['des'] ?? '',
        'created_at' => $row['created_at'] ?? ''
    ];
}

if (isset($_GET['refresh_print_card']) && $_GET['refresh_print_card'] === '1') {
    header('Content-Type: application/json');

    try {
        $fNumber = cleanNumberOnly($_GET['f_number'] ?? '');
        $path = regeneratePrintCardFromExistingJpg($db, $fNumber);
        $details = getLatestPrintCardRevisionDetailsForIndex($db, $fNumber);

        echo json_encode([
            'success' => true,
            'path' => $path,
            'f_number' => $fNumber,
            'details' => $details,
            'version' => time()
        ]);
    } catch (Exception $e) {
        echo json_encode([
            'success' => false,
            'message' => $e->getMessage()
        ]);
    }

    exit;
}


function findGhostscriptBinary() {
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

function renderPdfPageWithGhostscript($pdfFullPath, $jpgOutPath, $density = 300, $tempDir = '') {
    $gs = findGhostscriptBinary();

    if (!$gs) {
        throw new Exception("Ghostscript not found. If you are on XAMPP/Mac, install it with Homebrew using: brew install ghostscript");
    }

    if (!file_exists($pdfFullPath)) {
        throw new Exception("PDF not found for Ghostscript render: " . $pdfFullPath);
    }

    if (!$tempDir) {
        $tempDir = __DIR__ . '/magick_tmp';
    }

    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }

    @chmod($tempDir, 0777);

    $baseCmd =
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
        ' -dJPEGQ=95' .
        ' -r' . intval($density) .
        ' -dGraphicsAlphaBits=4' .
        ' -dTextAlphaBits=4' .
        ' -sOutputFile=' . escapeshellarg($jpgOutPath) .
        ' ' . escapeshellarg($pdfFullPath) .
        ' 2>&1';

    exec($baseCmd, $out, $ret);

    if ($ret !== 0 || !file_exists($jpgOutPath)) {
        throw new Exception("Ghostscript PDF render failed using " . $gs . ": " . implode("\n", $out));
    }
}


if ($_SERVER['REQUEST_METHOD'] === 'POST' && ($_POST['action'] ?? '') === 'create_print_card') {
    $g_number = cleanArtIdentifier($_POST['g_number'] ?? '');
    $f_number = cleanNumberOnly($_POST['f_number'] ?? '');
    $d_number = cleanAlphaNumber($_POST['d_number'] ?? '');
    $approval_pdf = safePath($_POST['approval_pdf'] ?? '');
    $replaceArtOnly = (($_POST['replace_art_only'] ?? '') === '1');

    $rev = forceUpperText($_POST['rev'] ?? '');
    $rev_date = forceUpperText($_POST['rev_date'] ?? date('n/j/y'));
    $description = forceUpperText($_POST['description'] ?? '');
    $csr = forceUpperText($_POST['csr'] ?? '');
    $des = forceUpperText($_POST['des'] ?? '');

    $approval_pdf_full = __DIR__ . '/' . $approval_pdf;

    $useAlternatePdf = false;
    $alternate_pdf_full = '';

    if (
        isset($_FILES['alternate_print_pdf']) &&
        $_FILES['alternate_print_pdf']['error'] === UPLOAD_ERR_OK &&
        !empty($_FILES['alternate_print_pdf']['tmp_name'])
    ) {
        $uploadedName = $_FILES['alternate_print_pdf']['name'] ?? '';
        $uploadedExt = strtolower(pathinfo($uploadedName, PATHINFO_EXTENSION));

        if ($uploadedExt !== 'pdf') {
            $printCardMessage = 'Alternate print card file must be a PDF.';
        } else {
            $temp_upload_dir = __DIR__ . '/temp_print_card_uploads';

            if (!is_dir($temp_upload_dir)) {
                mkdir($temp_upload_dir, 0777, true);
            }

            @chmod($temp_upload_dir, 0777);

            $alternate_pdf_full = $temp_upload_dir . '/alternate_' . $f_number . '_' . time() . '.pdf';

            if (move_uploaded_file($_FILES['alternate_print_pdf']['tmp_name'], $alternate_pdf_full)) {
                $useAlternatePdf = true;
            } else {
                $printCardMessage = 'Could not save the alternate print card PDF.';
            }
        }
    }

    if (!$printCardMessage && (!$g_number || !$f_number)) {
        $printCardMessage = 'Missing G# or F#.';
    }

    /*
        Approval PDF is now optional.
        If no approval PDF exists and no alternate PDF is uploaded, the print card will still be created
        with a blank white artwork area and the revision/info strip on the right.

        When Replace Image Only is used, this same artwork-generation flow runs, but NO revision row
        is inserted into print_card_revisions.
    */

    if (!$printCardMessage && !$replaceArtOnly) {
        $stmt = $db->prepare("
            INSERT INTO print_card_revisions 
            (g_number, f_number, d_number, rev, rev_date, description, csr, des)
            VALUES 
            (:g_number, :f_number, :d_number, :rev, :rev_date, :description, :csr, :des)
        ");
        $stmt->bindValue(':g_number', $g_number);
        $stmt->bindValue(':f_number', $f_number);
        $stmt->bindValue(':d_number', $d_number);
        $stmt->bindValue(':rev', $rev);
        $stmt->bindValue(':rev_date', $rev_date);
        $stmt->bindValue(':description', $description);
        $stmt->bindValue(':csr', $csr);
        $stmt->bindValue(':des', $des);
        $stmt->execute();
    }

    if (!$printCardMessage) {
        $revisions = getLatestFourRevisionsForPrintCard($db, $f_number, $g_number);

        $output_dir = __DIR__ . '/print_cards';
        if (!is_dir($output_dir)) {
            mkdir($output_dir, 0777, true);
        }

        $magick_tmp = __DIR__ . '/magick_tmp';
        if (!is_dir($magick_tmp)) {
            mkdir($magick_tmp, 0777, true);
        }

        @chmod($output_dir, 0777);
        @chmod($magick_tmp, 0777);

        $output_file = $output_dir . '/' . $f_number . '.jpg';
        $output_web = 'print_cards/' . $f_number . '.jpg';

        try {
            $magick = '/usr/local/bin/magick';

            if (!file_exists($magick)) {
                throw new Exception("ImageMagick not found at /usr/local/bin/magick.");
            }

            $magick_env =
                'PATH=/usr/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
                'MAGICK_TEMPORARY_PATH=' . escapeshellarg($magick_tmp) . ' ' .
                'TMPDIR=' . escapeshellarg($magick_tmp) . ' ';

            // 10" x 4" final print card at 300 dpi
            $card_w = 3000;
            $card_h = 1200;

            // Right info block width
            $info_w = 300;

            // Artwork area is the remaining left side
            $art_w = $card_w - $info_w;
            $art_h = $card_h;

            // Approval crop settings. Only used when no alternate PDF is uploaded.
            $crop_x = 75;
            $crop_y = 375;
            $crop_w = 3150;
            $crop_h = 1650;

            $temp_art = $output_dir . '/temp_art_' . $f_number . '.jpg';
            $temp_info = $output_dir . '/temp_info_' . $f_number . '.jpg';
            $hasApprovalPdf = ($approval_pdf && file_exists($approval_pdf_full));

            if ($useAlternatePdf) {
                // Optional alternate PDF is expected to be 10" x 5".
                // No crop is applied. It is resized and centered into the artwork area.
                $temp_rendered_pdf = $output_dir . '/rendered_pdf_' . $f_number . '_' . time() . '.jpg';
                renderPdfPageWithGhostscript($alternate_pdf_full, $temp_rendered_pdf, 300, $magick_tmp);

                $cmd1 = $magick_env . escapeshellcmd($magick) .
                    ' ' . escapeshellarg($temp_rendered_pdf) .
                    ' -background white ' .
                    ' -flatten ' .
                    ' -resize ' . $art_w . 'x' . $art_h .
                    ' -gravity center ' .
                    ' -extent ' . $art_w . 'x' . $art_h .
                    ' ' . escapeshellarg($temp_art) . ' 2>&1';
            } elseif ($hasApprovalPdf) {
                // Standard approval PDF workflow: crop before fitting.
                $temp_rendered_pdf = $output_dir . '/rendered_pdf_' . $f_number . '_' . time() . '.jpg';
                renderPdfPageWithGhostscript($approval_pdf_full, $temp_rendered_pdf, 300, $magick_tmp);

                $cmd1 = $magick_env . escapeshellcmd($magick) .
                    ' ' . escapeshellarg($temp_rendered_pdf) .
                    ' -background white ' .
                    ' -flatten ' .
                    ' -crop ' . $crop_w . 'x' . $crop_h . '+' . $crop_x . '+' . $crop_y .
                    ' +repage ' .
                    ' -resize ' . $art_w . 'x' . $art_h .
                    ' -gravity center ' .
                    ' -extent ' . $art_w . 'x' . $art_h .
                    ' ' . escapeshellarg($temp_art) . ' 2>&1';
            } else {
                // No approval PDF and no alternate PDF. Create a blank artwork area so the print card can still be generated.
                $cmd1 = $magick_env . escapeshellcmd($magick) .
                    ' -size ' . $art_w . 'x' . $art_h .
                    ' xc:white ' .
                    escapeshellarg($temp_art) . ' 2>&1';
            }

            exec($cmd1, $out1, $ret1);

            if ($ret1 !== 0 || !file_exists($temp_art)) {
                throw new Exception("Artwork creation failed: " . implode("\n", $out1));
            }

            createInfoBlockWithGD($db, $temp_info, $info_w, $card_h, $f_number, $d_number, $g_number, $revisions);

            $cmd3 = $magick_env . escapeshellcmd($magick) .
                ' ' . escapeshellarg($temp_art) .
                ' ' . escapeshellarg($temp_info) .
                ' +append -quality 95 ' .
                escapeshellarg($output_file) . ' 2>&1';

            exec($cmd3, $out3, $ret3);

            if ($ret3 !== 0 || !file_exists($output_file)) {
                throw new Exception("Final JPG failed: " . implode("\n", $out3));
            }

            @unlink($temp_art);
            @unlink($temp_info);
            if (isset($temp_rendered_pdf) && $temp_rendered_pdf && file_exists($temp_rendered_pdf)) {
                @unlink($temp_rendered_pdf);
            }

            if ($useAlternatePdf && $alternate_pdf_full && file_exists($alternate_pdf_full)) {
                @unlink($alternate_pdf_full);
            }

            if (isset($_POST['ajax_create_print_card']) && $_POST['ajax_create_print_card'] === '1') {
                header('Content-Type: application/json');
                echo json_encode([
                    'success' => true,
                    'path' => $output_web,
                    'f_number' => $f_number,
                    'message' => ($replaceArtOnly ? 'Print card image replaced: ' : 'Print card created: ') . $f_number . '.jpg',
                    'version' => time()
                ]);
                exit;
            }

            $redirectUrl = 'index.php?created_print_card=' . urlencode($output_web) . '&created_f=' . urlencode($f_number);
            header('Location: ' . $redirectUrl);
            exit;

        } catch (Exception $e) {
            if ($useAlternatePdf && $alternate_pdf_full && file_exists($alternate_pdf_full)) {
                @unlink($alternate_pdf_full);
            }
            if (isset($temp_rendered_pdf) && $temp_rendered_pdf && file_exists($temp_rendered_pdf)) {
                @unlink($temp_rendered_pdf);
            }

            $printCardMessage = 'Error creating print card: ' . htmlspecialchars($e->getMessage());

            if (isset($_POST['ajax_create_print_card']) && $_POST['ajax_create_print_card'] === '1') {
                header('Content-Type: application/json');
                echo json_encode([
                    'success' => false,
                    'message' => 'Error creating print card: ' . $e->getMessage()
                ]);
                exit;
            }
        }
    }

    if ($printCardMessage && isset($_POST['ajax_create_print_card']) && $_POST['ajax_create_print_card'] === '1') {
        header('Content-Type: application/json');
        echo json_encode([
            'success' => false,
            'message' => strip_tags($printCardMessage)
        ]);
        exit;
    }
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

$vendorSearch = trim($_GET['vendor_search'] ?? '');

if ($vendorSearch !== '') {
    $vendorStmt = $db->prepare("
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
    $vendorStmt->bindValue(':search', '%' . $vendorSearch . '%');
    $vendorResults = $vendorStmt->execute();
} else {
    $vendorResults = $db->query("
        SELECT *
        FROM vendor_art
        ORDER BY id DESC
        LIMIT 25
    ");
}

?>

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/gm2-base.css?v=<?php echo filemtime('assets/css/gm2-base.css'); ?>">
<link rel="stylesheet" href="assets/css/gm2-index.css?v=<?php echo filemtime('assets/css/gm2-index.css'); ?>">
<title>Graphics Management System</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">

</head>

<body class="index-page">
<div class="wrapper">
    

    <header class="app-header">
        <img class="app-logo" src="SUMTER HC-LOGO-HORIZONTAL-web.png" alt="Logo">
        <h1>Graphics Management System</h1>
        <p class="subtitle">Search and preview Graphics numbers.</p>
        <nav class="page-nav" aria-label="Page navigation">
            <a class="active" href="index.php">G# List</a>
       <!-- <a href="create_approval.php">Create Approval</a> -->
            <a href="printcard_revisions.php">Print Card Revisions</a>
        </nav>
                <a class="admin-corner-link" href="admin.php">Admin</a>

    </header>

    <section class="card gm-card index-data-card">
        <div class="gm2-section-kicker">Graphics Database</div>
        <h2 id="graphicsHeading"><?php echo $search ? 'Search Results' : 'Latest 10 Graphics Numbers'; ?></h2>

        <?php if ($printCardMessage && !$printCardCreated): ?>
            <div class="message">
                <?php echo $printCardMessage; ?>
            </div>
        <?php endif; ?>

        <div id="ajaxPrintCardMessage" class="message is-hidden"></div>

        <form method="GET" class="search-form" id="graphicsSearchForm">
            <input 
                type="text" 
                name="search" 
                id="graphicsLiveSearch"
                placeholder="Live search G#, Customer #, Customer Name, or Part #"
                value="<?php echo htmlspecialchars($search); ?>"
                autocomplete="off"
            >
            <button type="submit">Search</button>
            <button type="button" class="action-btn button-reset" onclick="printDisplayedGraphicsReport()">Print Displayed Results</button>
        </form>

        <?php if ($search): ?>
            <p class="muted">
                Showing results for: <strong><?php echo htmlspecialchars($search); ?></strong>
                | <a class="inline-clear-link" href="index.php">Clear Search</a>
            </p>
        <?php endif; ?>

        <div class="gm-table-wrap">
        <table id="graphicsTable" class="gm-table">
            <thead>
            <tr>
                <th>G#</th>
                <th>Customer #</th>
                <th>Customer Name</th>
                <th>Part #</th>
                <th>Preview</th>
                <th>Print Card</th>
            </tr>
            </thead>
            <tbody id="graphicsTableBody">

            <?php while ($row = $results->fetchArray(SQLITE3_ASSOC)): ?>
            <?php
                $latestPrintCard = getLatestPrintCardForG($db, $row['g_number']);
                $approvalPreview = getLatestApprovalPreviewForG($db, $row['g_number'], $row['preview_image'] ?? '');
            ?>
            <tr>
                <td class="gnum"><?php echo htmlspecialchars($row['g_number']); ?></td>
                <td><?php echo htmlspecialchars($row['customer_number']); ?></td>
                <td><?php echo htmlspecialchars($row['customer_name']); ?></td>
                <td><?php echo htmlspecialchars($row['part_number']); ?></td>
                <td>
                    <?php if (!empty($approvalPreview)): ?>
                        <button 
                            type="button" 
                            class="icon-btn"
                            title="View Preview"
                            onclick="openPreview('<?php echo htmlspecialchars($approvalPreview, ENT_QUOTES); ?>', '<?php echo htmlspecialchars($row['g_number'], ENT_QUOTES); ?>')"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="3"></circle></svg><span class="sr-only">View</span>
                        </button>
                    <?php endif; ?>
                </td>
                <td>
                    <button
                        type="button"
                        class="icon-btn"
                        title="Create Print Card"
                        onclick="openPrintCardModal(
                            '<?php echo htmlspecialchars($row['g_number'], ENT_QUOTES); ?>',
                            '<?php echo htmlspecialchars($approvalPreview ?? '', ENT_QUOTES); ?>',
                            '<?php echo $latestPrintCard ? htmlspecialchars($latestPrintCard['f_number'], ENT_QUOTES) : ''; ?>',
                            '<?php echo $latestPrintCard ? htmlspecialchars($latestPrintCard['d_number'], ENT_QUOTES) : ''; ?>',
                            '<?php echo $latestPrintCard ? htmlspecialchars($latestPrintCard['csr'], ENT_QUOTES) : ''; ?>',
                            '<?php echo $latestPrintCard ? htmlspecialchars($latestPrintCard['des'], ENT_QUOTES) : ''; ?>',
                            '<?php echo $latestPrintCard ? htmlspecialchars($latestPrintCard['next_rev'], ENT_QUOTES) : '0'; ?>'
                        )"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M12 18v-6"></path><path d="M9 15h6"></path></svg><span class="sr-only">Create Print Card</span>
                    </button>

                    <button
                        type="button"
                        class="icon-btn<?php echo !$latestPrintCard ? ' is-disabled' : ''; ?>"
                        title="<?php echo $latestPrintCard ? 'View Latest Print Card' : 'No Print Card Exists'; ?>"
                        <?php if ($latestPrintCard): ?>
                            onclick="openLatestPrintCard(
                                '<?php echo htmlspecialchars($latestPrintCard['web_path'], ENT_QUOTES); ?>',
                                '<?php echo htmlspecialchars($latestPrintCard['f_number'], ENT_QUOTES); ?>'
                            )"
                        <?php else: ?>
                            disabled
                        <?php endif; ?>
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg><span class="sr-only">View Print Card</span>
                    </button>
                </td>
            </tr>
            <?php endwhile; ?>
            </tbody>
        </table>
        </div>
    </section>

    <section class="card gm-card vendor-section admin-section-gap">
        <div class="gm2-section-kicker">Vendor Art Database</div>
        <h2>Vendor Art Management</h2>
        <p class="muted">Search vendor-supplied approvals, view the uploaded approval PDF, or create a print card from the vendor artwork.</p>

        <form method="GET" class="search-form">
            <input
                type="text"
                name="vendor_search"
                placeholder="Search Vendor Art #, vendor, customer, or part #"
                value="<?php echo htmlspecialchars($vendorSearch); ?>"
                autocomplete="off"
            >
            <button type="submit">Search Vendor Art</button>
            <a class="action-btn compact-link" href="index.php">Show All</a>
        </form>

        <div class="gm-table-wrap">
        <table id="vendorArtTable" class="gm-table">
            <thead>
            <tr>
                <th>Vendor Art #</th>
                <th>Vendor</th>
                <th>Customer #</th>
                <th>Customer Name</th>
                <th>Part #</th>
                <th>Preview</th>
                <th>Print Card</th>
            </tr>
            </thead>
            <tbody>
            <?php while ($vendorRow = $vendorResults->fetchArray(SQLITE3_ASSOC)): ?>
            <?php
                $vendorLatestPrintCard = getLatestPrintCardForG($db, $vendorRow['vendor_art_number']);
                $vendorPreview = safePath($vendorRow['preview_image'] ?? '');
            ?>
            <tr>
                <td class="gnum"><?php echo htmlspecialchars($vendorRow['vendor_art_number']); ?></td>
                <td><?php echo htmlspecialchars($vendorRow['vendor_name']); ?></td>
                <td><?php echo htmlspecialchars($vendorRow['customer_number']); ?></td>
                <td><?php echo htmlspecialchars($vendorRow['customer_name']); ?></td>
                <td><?php echo htmlspecialchars($vendorRow['part_number']); ?></td>
                <td>
                    <?php if ($vendorPreview): ?>
                        <button
                            type="button"
                            class="icon-btn"
                            title="View Vendor Approval"
                            onclick="openPreview('<?php echo htmlspecialchars($vendorPreview, ENT_QUOTES); ?>', '', true)"
                        >
                            <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="3"></circle></svg><span class="sr-only">View</span>
                        </button>
                    <?php endif; ?>
                </td>
                <td>
                    <button
                        type="button"
                        class="icon-btn"
                        title="Create Print Card"
                        onclick="openPrintCardModal(
                            '<?php echo htmlspecialchars($vendorRow['vendor_art_number'], ENT_QUOTES); ?>',
                            '<?php echo htmlspecialchars($vendorPreview, ENT_QUOTES); ?>',
                            '<?php echo $vendorLatestPrintCard ? htmlspecialchars($vendorLatestPrintCard['f_number'], ENT_QUOTES) : ''; ?>',
                            '<?php echo $vendorLatestPrintCard ? htmlspecialchars($vendorLatestPrintCard['d_number'], ENT_QUOTES) : ''; ?>',
                            '<?php echo $vendorLatestPrintCard ? htmlspecialchars($vendorLatestPrintCard['csr'], ENT_QUOTES) : ''; ?>',
                            '<?php echo $vendorLatestPrintCard ? htmlspecialchars($vendorLatestPrintCard['des'], ENT_QUOTES) : ''; ?>',
                            '<?php echo $vendorLatestPrintCard ? htmlspecialchars($vendorLatestPrintCard['next_rev'], ENT_QUOTES) : '0'; ?>'
                        )"
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M12 18v-6"></path><path d="M9 15h6"></path></svg><span class="sr-only">Create Print Card</span>
                    </button>

                    <button
                        type="button"
                        class="icon-btn<?php echo !$vendorLatestPrintCard ? ' is-disabled' : ''; ?>"
                        title="<?php echo $vendorLatestPrintCard ? 'View Latest Print Card' : 'No Print Card Exists'; ?>"
                        <?php if ($vendorLatestPrintCard): ?>
                            onclick="openLatestPrintCard(
                                '<?php echo htmlspecialchars($vendorLatestPrintCard['web_path'], ENT_QUOTES); ?>',
                                '<?php echo htmlspecialchars($vendorLatestPrintCard['f_number'], ENT_QUOTES); ?>'
                            )"
                        <?php else: ?>
                            disabled
                        <?php endif; ?>
                    >
                        <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg><span class="sr-only">View Print Card</span>
                    </button>
                </td>
            </tr>
            <?php endwhile; ?>
            </tbody>
        </table>
        </div>
    </section>


</div>

<div id="previewModal" class="preview-modal" data-current-g="" data-current-src="" onclick="closePreview()">
    <div class="preview-box" onclick="event.stopPropagation()">
        <button type="button" class="close-preview" onclick="closePreview()">×</button>

        <img id="previewImage" class="is-hidden" src="" alt="Graphics Preview">

        <iframe 
            id="previewPDF"
            class="preview-pdf-frame is-hidden">
        </iframe>

        <a
            id="openApprovalPdfBtn"
            class="gm-btn gm-btn-secondary is-hidden"
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
            onclick="deleteCurrentApprovalPreview()"
            class="gm-btn-danger is-hidden"
        >
            Remove Approval Preview + Delete File
        </button>

        <div class="approval-compare-toggle" id="approvalCompareToggle">
            <button type="button" onclick="toggleApprovalCompare()">Compare Revisions</button>
        </div>

        <div class="approval-compare-panel" id="approvalComparePanel">
            <div class="compare-top">
                <div>
                    <label>Compare Previous Approval Revision</label>
                    <select id="approvalCompareSelect" onchange="renderApprovalCompareSelection()" class="compare-select"></select>
                </div>
                <button type="button" class="secondary" onclick="toggleApprovalCompare()">Hide Compare</button>
            </div>

            <div class="compare-summary">
                <div class="compare-summary-card">
                    <strong id="comparePreviousTitle">Previous Revision</strong>
                    <span id="comparePreviousSummary">Select a revision to compare.</span>
                </div>
                <div class="compare-summary-card">
                    <strong>Current Approval</strong>
                    <span id="compareCurrentSummary">Current PDF attached to this G#.</span>
                </div>
            </div>

            <div class="compare-grid">
                <div class="compare-view">
                    <h3 id="comparePreviousHeading">Previous Snapshot</h3>
                    <img id="comparePreviousImage" src="" alt="Previous Approval Snapshot">
                </div>
                <div class="compare-view">
                    <h3>Current Approval PDF</h3>
                    <iframe id="compareCurrentPdf" src="" title="Current Approval PDF"></iframe>
                </div>
            </div>
        </div>
    </div>
</div>

<div id="printCardModal" class="printcard-modal">
    <div class="printcard-box" onclick="event.stopPropagation()">
        <button type="button" class="close-preview" onclick="closePrintCardModal()">×</button>

        <h2>Create Print Card</h2>
        <p class="muted">This will create a 10&quot; × 4&quot; JPG and name it as the F#. If no approval PDF is available, it will use a blank artwork area.</p>

        <form method="POST" enctype="multipart/form-data" id="printCardForm">
            <input type="hidden" name="action" value="create_print_card">
            <input type="hidden" name="ajax_create_print_card" value="1">
            <input type="hidden" name="replace_art_only" id="pc_replace_art_only" value="0">
            <input type="hidden" name="approval_pdf" id="pc_approval_pdf">

            <label>Optional Print Card PDF</label>
            <input 
                type="file" 
                name="alternate_print_pdf" 
                accept="application/pdf,.pdf"
            >
            <p class="muted mt-6">
                Optional 10&quot; × 5&quot; PDF. If uploaded, this file will be used for the print card artwork. If nothing is uploaded and no approval exists, a blank artwork area will be used.
            </p>

            <label>Art #</label>
            <input name="g_number" id="pc_g_number" readonly>

            <label>F#</label>
            <input name="f_number" id="pc_f_number" required placeholder="Example: 318549">

            <label>D#</label>
            <input name="d_number" id="pc_d_number" class="uppercase-input" placeholder="Design number, example: 082165A">

            <label>Rev #</label>
            <input name="rev" id="pc_rev" class="uppercase-input" value="0">

            <label>Date</label>
            <input name="rev_date" class="uppercase-input" value="<?php echo strtoupper(date('n/j/y')); ?>">

            <label>Description</label>
            <textarea name="description" class="uppercase-input" placeholder="Example: FOR RELEASE"></textarea>

            <label>CSR</label>
            <input name="csr" id="pc_csr" class="uppercase-input" placeholder="CSR initials">

            <label>DES</label>
            <input name="des" id="pc_des" class="uppercase-input" placeholder="Designer initials">

            <button type="submit" data-mode="revision">Create Print Card + Add Revision</button>
            <button 
                type="submit" 
                data-mode="replace-art"
                class="replace-art-button"
            >
                Replace Image Only / No Revision
            </button>
        </form>
    </div>
</div>



<div id="latestCardModal" class="latest-card-modal printcard-preview-modal">
    <div class="latest-card-box gm-card printcard-preview-box" onclick="event.stopPropagation()">
        <button type="button" class="close-preview close-modal" onclick="closeLatestPrintCard()">×</button>

        <div class="printcard-preview-header">
            <div>
                <h2 id="latestCardTitle">Print Card Preview</h2>
                <p class="muted" id="latestCardSubtitle"></p>
            </div>
        </div>

        <div class="printcard-preview-layout">
            <div class="view-image-wrap printcard-preview-image-panel">
                <img 
                    id="latestCardImage"
                    class="print-card-preview-img printcard-preview-image"
                    src=""
                    alt="Latest Print Card"
                >
            </div>

            <aside class="printcard-preview-info-panel" aria-label="Print card details">
                <div class="view-grid printcard-preview-info-grid">
                    <div class="view-field">
                        <span class="view-label">F#</span>
                        <span class="view-value" id="latestViewF"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">G#</span>
                        <span class="view-value" id="latestViewG"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">D#</span>
                        <span class="view-value" id="latestViewD"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">Revision</span>
                        <span class="view-value" id="latestViewRev"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">Date</span>
                        <span class="view-value" id="latestViewDate"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">CSR / DES</span>
                        <span class="view-value" id="latestViewPeople"></span>
                    </div>

                    <div class="view-field wide">
                        <span class="view-label">Description</span>
                        <span class="view-value" id="latestViewDescription"></span>
                    </div>

                    <div class="view-field wide">
                        <span class="view-label">Created</span>
                        <span class="view-value" id="latestViewCreated"></span>
                    </div>
                </div>

                <div class="printcard-preview-actions">
                    <a 
                        id="latestCardDownload"
                        class="gm-btn gm-btn-secondary"
                        href="#" 
                        download
                    >
                        Download Image
                    </a>
                    <a
                        id="latestCardEditLink"
                        class="gm-btn gm-btn-primary"
                        href="#"
                    >
                        Edit Print Card
                    </a>
                </div>
            </aside>
        </div>
    </div>
</div>


<?php if ($printCardCreated && $printCardDownload): ?>
<div id="printCardResultModal" class="result-modal active" onclick="closeResultModal()">
    <div class="result-box" onclick="event.stopPropagation()">
        <button type="button" class="close-preview" onclick="closeResultModal()">×</button>

        <h2>Print Card Created</h2>
        <p class="muted"><?php echo $printCardMessage; ?></p>

        <img 
            class="print-card-preview-img"
            src="<?php echo htmlspecialchars($printCardDownload); ?>?v=<?php echo time(); ?>" 
            alt="Generated Print Card"
        >

        <div class="result-actions">
            <a 
                class="button-link"
                href="index.php?gm2_download=1&file=<?php echo urlencode($printCardDownload); ?>&name=<?php echo urlencode($createdF . '.jpg'); ?>"
            >
                Download JPG
            </a>
            <button type="button" onclick="closeResultModal()">Close</button>
        </div>
    </div>
</div>
<?php endif; ?>

<script>

const graphicsSearchInput = document.getElementById('graphicsLiveSearch');
const graphicsSearchForm = document.getElementById('graphicsSearchForm');
let graphicsSearchTimer = null;

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

function renderGraphicsRows(rows) {
    const tbody = document.getElementById('graphicsTableBody');
    const heading = document.getElementById('graphicsHeading');

    if (!tbody) return;

    if (!rows.length) {
        tbody.innerHTML = `
            <tr class="no-results-row">
                <td colspan="6" class="muted">No matching Graphics numbers found.</td>
            </tr>
        `;
        if (heading) heading.textContent = (graphicsSearchInput && graphicsSearchInput.value.trim()) ? 'Search Results' : 'Latest 10 Graphics Numbers';
        return;
    }

    tbody.innerHTML = rows.map(row => {
        const preview = row.preview_image || '';
        const latest = row.latest_print_card || null;

        const previewButton = preview ? `
            <button 
                type="button" 
                class="icon-btn"
                title="View Preview"
                onclick="openPreview('${escapeJs(preview)}', '${escapeJs(row.g_number)}')"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M2 12s3.5-6 10-6 10 6 10 6-3.5 6-10 6-10-6-10-6Z"></path><circle cx="12" cy="12" r="3"></circle></svg><span class="sr-only">View</span>
            </button>
        ` : '';

        const pcButton = `
            <button
                type="button"
                class="icon-btn"
                title="Create Print Card"
                onclick="openPrintCardModal(
                    '${escapeJs(row.g_number)}',
                    '${escapeJs(preview)}',
                    '${latest ? escapeJs(latest.f_number) : ''}',
                    '${latest ? escapeJs(latest.d_number) : ''}',
                    '${latest ? escapeJs(latest.csr) : ''}',
                    '${latest ? escapeJs(latest.des) : ''}',
                    '${latest ? escapeJs(latest.next_rev) : '0'}'
                )"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8Z"></path><path d="M14 2v6h6"></path><path d="M12 18v-6"></path><path d="M9 15h6"></path></svg><span class="sr-only">Create Print Card</span>
            </button>
        `;

        const viewButton = latest ? `
            <button
                type="button"
                class="icon-btn"
                title="View Latest Print Card"
                onclick="openLatestPrintCard('${escapeJs(latest.web_path)}', '${escapeJs(latest.f_number)}')"
            >
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg><span class="sr-only">View Print Card</span>
            </button>
        ` : `
            <button
                type="button"
                class="icon-btn is-disabled"
                title="No Print Card Exists"
                disabled
            >
                <svg viewBox="0 0 24 24" aria-hidden="true"><rect x="3" y="3" width="18" height="18" rx="2"></rect><circle cx="8.5" cy="8.5" r="1.5"></circle><path d="M21 15l-5-5L5 21"></path></svg><span class="sr-only">View Print Card</span>
            </button>
        `;

        return `
            <tr class="graphics-data-row">
                <td class="gnum">${escapeHtml(row.g_number)}</td>
                <td>${escapeHtml(row.customer_number)}</td>
                <td>${escapeHtml(row.customer_name)}</td>
                <td>${escapeHtml(row.part_number)}</td>
                <td>${previewButton}</td>
                <td>${pcButton}${viewButton}</td>
            </tr>
        `;
    }).join('');

    if (heading) heading.textContent = (graphicsSearchInput && graphicsSearchInput.value.trim()) ? 'Search Results' : 'Latest 10 Graphics Numbers';
}

function liveSearchGraphics() {
    const q = graphicsSearchInput ? graphicsSearchInput.value : '';

    fetch('index.php?ajax_search=1&q=' + encodeURIComponent(q), {
        cache: 'no-store'
    })
    .then(response => response.json())
    .then(rows => renderGraphicsRows(rows))
    .catch(error => {
        console.error('Live search error:', error);
    });
}

if (graphicsSearchForm) {
    graphicsSearchForm.addEventListener('submit', function(event) {
        event.preventDefault();
        liveSearchGraphics();
    });
}

if (graphicsSearchInput) {
    graphicsSearchInput.addEventListener('input', function() {
        clearTimeout(graphicsSearchTimer);
        graphicsSearchTimer = setTimeout(liveSearchGraphics, 150);
    });
}

if (graphicsSearchInput) {
    graphicsSearchInput.addEventListener('contextmenu', function(event) {
        event.preventDefault();

        graphicsSearchInput.value = '';

        liveSearchGraphics();
    });
}

function printDisplayedGraphicsReport() {
    const rows = Array.from(document.querySelectorAll('#graphicsTableBody tr'))
        .filter(row => !row.classList.contains('no-results-row'));

    const searchText = graphicsSearchInput ? graphicsSearchInput.value.trim() : '';

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
<link rel="stylesheet" href="assets/css/gm2-base.css?v=<?php echo filemtime('assets/css/gm2-base.css'); ?>">
<link rel="stylesheet" href="assets/css/gm2-index.css?v=<?php echo filemtime('assets/css/gm2-index.css'); ?>">
        </head>
        <body class="print-report-page">
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

let approvalCompareData = null;

function openPreview(src, gNumber = '', freshChecked = false) {
    if (gNumber && !freshChecked) {
        fetch('index.php?latest_approval=1&g_number=' + encodeURIComponent(gNumber) + '&v=' + Date.now(), {
            cache: 'no-store'
        })
        .then(response => response.json())
        .then(data => {
            const latestSrc = (data && data.success && data.preview_image) ? data.preview_image : src;
            openPreview(latestSrc, gNumber, true);
        })
        .catch(error => {
            console.warn('Latest approval lookup failed, opening existing preview.', error);
            openPreview(src, gNumber, true);
        });
        return;
    }

    const img = document.getElementById('previewImage');
    const pdf = document.getElementById('previewPDF');
    const modal = document.getElementById('previewModal');
    const deleteBtn = document.getElementById('deleteApprovalPreviewBtn');
    const compareToggle = document.getElementById('approvalCompareToggle');
    const comparePanel = document.getElementById('approvalComparePanel');

    src = src || '';

    const openPdfBtn = document.getElementById('openApprovalPdfBtn');

    if (src.toLowerCase().endsWith('.pdf')) {
        pdf.style.display = 'none';
        pdf.classList.add('is-hidden');
        pdf.src = src + (src.indexOf('?') === -1 ? '?v=' + Date.now() : '&v=' + Date.now());
        img.style.display = 'block';
        img.classList.remove('is-hidden');
        img.src = 'index.php?gm2_pdf_preview=1&file=' + encodeURIComponent(src) + '&v=' + Date.now();
        if (openPdfBtn) {
            openPdfBtn.href = src;
            openPdfBtn.classList.remove('is-hidden');
        }
    } else {
        pdf.style.display = 'none';
        pdf.classList.add('is-hidden');
        img.style.display = 'block';
        img.classList.remove('is-hidden');
        img.src = src + (src.indexOf('?') === -1 ? '?v=' + Date.now() : '&v=' + Date.now());
        if (openPdfBtn) {
            openPdfBtn.href = '#';
            openPdfBtn.classList.add('is-hidden');
        }
    }

    if (modal) {
        modal.dataset.currentG = gNumber || '';
        modal.dataset.currentSrc = src || '';
    }

    if (deleteBtn) {
        // Only show the delete button for approval files generated by create_approval.php.
        deleteBtn.style.display = src && src.indexOf('approvals/') === 0 ? 'block' : 'none';
    }

    if (compareToggle) {
        compareToggle.style.display = (src && src.indexOf('approvals/') === 0 && gNumber) ? 'flex' : 'none';
    }

    if (comparePanel) {
        comparePanel.classList.remove('active');
    }

    approvalCompareData = null;

    modal.classList.add('active');
}
function closePreview() {
    const modal = document.getElementById('previewModal');
    const deleteBtn = document.getElementById('deleteApprovalPreviewBtn');

    modal.classList.remove('active');
    modal.dataset.currentG = '';
    modal.dataset.currentSrc = '';

    document.getElementById('previewImage').src = '';
    document.getElementById('previewPDF').src = '';
    const openPdfBtn = document.getElementById('openApprovalPdfBtn');
    if (openPdfBtn) {
        openPdfBtn.href = '#';
        openPdfBtn.classList.add('is-hidden');
    }

    if (deleteBtn) {
        deleteBtn.style.display = 'none';
    }

    const compareToggle = document.getElementById('approvalCompareToggle');
    const comparePanel = document.getElementById('approvalComparePanel');
    const compareSelect = document.getElementById('approvalCompareSelect');
    const comparePreviousImage = document.getElementById('comparePreviousImage');
    const compareCurrentPdf = document.getElementById('compareCurrentPdf');

    if (compareToggle) compareToggle.style.display = 'none';
    if (comparePanel) comparePanel.classList.remove('active');
    if (compareSelect) compareSelect.innerHTML = '';
    if (comparePreviousImage) comparePreviousImage.src = '';
    if (compareCurrentPdf) compareCurrentPdf.src = '';

    approvalCompareData = null;
}



function toggleApprovalCompare() {
    const modal = document.getElementById('previewModal');
    const panel = document.getElementById('approvalComparePanel');
    const gNumber = modal ? (modal.dataset.currentG || '') : '';

    if (!panel || !gNumber) return;

    if (panel.classList.contains('active')) {
        panel.classList.remove('active');
        return;
    }

    panel.classList.add('active');

    if (approvalCompareData && approvalCompareData.graphic && String(approvalCompareData.graphic.g_number) === String(gNumber).replace(/[^0-9]/g, '')) {
        renderApprovalCompareOptions();
        return;
    }

    fetch('index.php?approval_compare=1&g_number=' + encodeURIComponent(gNumber) + '&v=' + Date.now(), {
        cache: 'no-store'
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            throw new Error(data.message || 'Could not load approval revisions.');
        }

        approvalCompareData = data;
        renderApprovalCompareOptions();
    })
    .catch(error => {
        console.error('Approval compare error:', error);
        alert(error.message || 'Could not load approval comparison.');
        panel.classList.remove('active');
    });
}

function renderApprovalCompareOptions() {
    const select = document.getElementById('approvalCompareSelect');
    const previousSummary = document.getElementById('comparePreviousSummary');
    const previousImage = document.getElementById('comparePreviousImage');
    const currentPdf = document.getElementById('compareCurrentPdf');
    const currentSummary = document.getElementById('compareCurrentSummary');

    if (!select || !approvalCompareData) return;

    const revisions = approvalCompareData.revisions || [];
    const graphic = approvalCompareData.graphic || {};

    if (currentPdf) {
        currentPdf.src = (graphic.current_pdf || '') + '?v=' + Date.now();
    }

    if (currentSummary) {
        currentSummary.textContent = 'G#' + (graphic.g_number || '') + ' — ' + (graphic.customer_name || '') + ' — ' + (graphic.part_number || '');
    }

    if (!revisions.length) {
        select.innerHTML = '<option value="">No previous snapshots found</option>';
        if (previousSummary) previousSummary.textContent = 'No previous approval snapshots are available for this G# yet.';
        if (previousImage) previousImage.src = '';
        return;
    }

    select.innerHTML = revisions.map((rev, index) => {
        const label = 'Rev ' + (rev.rev || '') + ' — ' + (rev.rev_date || '') + ' — ' + (rev.description || '');
        return '<option value="' + index + '">' + escapeHtml(label) + '</option>';
    }).join('');

    select.value = String(revisions.length - 1);
    renderApprovalCompareSelection();
}

function renderApprovalCompareSelection() {
    const select = document.getElementById('approvalCompareSelect');
    const previousTitle = document.getElementById('comparePreviousTitle');
    const previousSummary = document.getElementById('comparePreviousSummary');
    const previousHeading = document.getElementById('comparePreviousHeading');
    const previousImage = document.getElementById('comparePreviousImage');

    if (!select || !approvalCompareData) return;

    const revisions = approvalCompareData.revisions || [];
    const selected = revisions[parseInt(select.value, 10)];

    if (!selected) return;

    if (previousTitle) {
        previousTitle.textContent = 'Previous Revision — Rev ' + (selected.rev || '');
    }

    if (previousHeading) {
        previousHeading.textContent = 'Previous Snapshot — Rev ' + (selected.rev || '');
    }

    if (previousSummary) {
        previousSummary.textContent =
            'Rev ' + (selected.rev || '') +
            ' | Date: ' + (selected.rev_date || '') +
            ' | Description: ' + (selected.description || '') +
            ' | CSR: ' + (selected.csr || '') +
            ' | DSR: ' + (selected.dsr || '');
    }

    if (previousImage) {
        previousImage.src = (selected.snapshot_image || '') + '?v=' + Date.now();
    }
}


function deleteCurrentApprovalPreview() {
    const modal = document.getElementById('previewModal');
    const gNumber = modal ? (modal.dataset.currentG || '') : '';

    if (!gNumber) {
        alert('Could not determine which G# this approval belongs to.');
        return;
    }

    if (!confirm('Remove this approval preview from G#' + gNumber + ' and delete the approval file?')) {
        return;
    }

    const formData = new FormData();
    formData.set('action', 'delete_approval_preview');
    formData.set('g_number', gNumber);

    fetch('index.php', {
        method: 'POST',
        body: formData,
        cache: 'no-store'
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            throw new Error(data.message || 'Could not delete approval.');
        }

        closePreview();
        showAjaxPrintCardMessage(data.message || 'Approval removed.', true);
        liveSearchGraphics();
    })
    .catch(error => {
        console.error('Delete approval error:', error);
        alert(error.message || 'Could not delete approval.');
    });
}


function openPrintCardModal(gNumber, approvalPdf, latestFNumber = '', latestDNumber = '', latestCSR = '', latestDES = '', nextRev = '0') {
    document.getElementById('pc_g_number').value = gNumber;
    document.getElementById('pc_approval_pdf').value = approvalPdf;

    const fInput = document.getElementById('pc_f_number');
    const csrInput = document.getElementById('pc_csr');
    const desInput = document.getElementById('pc_des');
    const revInput = document.getElementById('pc_rev');
    const dInput = document.getElementById('pc_d_number');
    const dateInput = document.querySelector('#printCardForm input[name="rev_date"]');
    const descriptionInput = document.querySelector('#printCardForm textarea[name="description"]');

    if (fInput) fInput.value = latestFNumber || '';
    if (dInput) dInput.value = (latestDNumber || '').toUpperCase();
    if (csrInput) csrInput.value = (latestCSR || '').toUpperCase();
    if (desInput) desInput.value = (latestDES || '').toUpperCase();
    if (revInput) revInput.value = (nextRev || '0').toUpperCase();

    document.getElementById('printCardModal').classList.add('active');

    const applyPrintCardRevisionDefaults = (fNumber) => {
        fetch('index.php?print_card_defaults=1&g_number=' + encodeURIComponent(gNumber) + '&f_number=' + encodeURIComponent(fNumber || ''), {
            cache: 'no-store'
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) return;

            const latest = data.latest_print_card || null;

            if (latest) {
                if (fInput) fInput.value = latest.f_number || fNumber || '';
                if (dInput && latest.d_number) dInput.value = latest.d_number.toUpperCase();
                if (csrInput && latest.csr) csrInput.value = latest.csr.toUpperCase();
                if (desInput && latest.des) desInput.value = latest.des.toUpperCase();

                if (revInput) {
                    revInput.value = (latest.next_rev || '0').toUpperCase();

                    // Brand new Print Card -> always start with FOR RELEASE.
                    if (revInput.value === '0' && descriptionInput) {
                        descriptionInput.value = 'FOR RELEASE';
                    }
                }
            } else {
                if (fInput && fNumber) fInput.value = fNumber;
                if (revInput) revInput.value = '0';

                if (descriptionInput) {
                    descriptionInput.value = 'FOR RELEASE';
                }
            }
        })
        .catch(error => {
            console.warn('Could not load print-card revision defaults:', error);
            if (revInput) revInput.value = '0';
        });
    };

    if (approvalPdf && approvalPdf.toLowerCase().endsWith('.pdf')) {
        fetch('index.php?approval_fields=1&pdf=' + encodeURIComponent(approvalPdf), {
            cache: 'no-store'
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success || !data.fields) {
                applyPrintCardRevisionDefaults(latestFNumber || '');
                return;
            }

            const fields = data.fields;

            // Approval values that are job-specific are allowed to populate the form.
            if (fields.f_number && fInput) fInput.value = fields.f_number.toUpperCase();
            if (dInput && fields.d_number) dInput.value = fields.d_number.toUpperCase();

            if (dateInput) {
                dateInput.value = new Date().toLocaleDateString('en-US', {
                    month: 'numeric',
                    day: 'numeric',
                    year: '2-digit'
                });
            }

            if (descriptionInput && fields.description) descriptionInput.value = fields.description.toUpperCase();
            if (csrInput && fields.csr) csrInput.value = fields.csr.toUpperCase();
            if (desInput && fields.des) desInput.value = fields.des.toUpperCase();

            // Approval Rev # is intentionally ignored.
            // Print Card Rev # comes only from print_card_revisions using G# + F#.
            applyPrintCardRevisionDefaults(fields.f_number || latestFNumber || '');
        })
        .catch(error => {
            console.warn('Could not auto-fill print card from approval PDF:', error);
            applyPrintCardRevisionDefaults(latestFNumber || '');
        });
    } else {
        applyPrintCardRevisionDefaults(latestFNumber || '');
    }
}


function showAjaxPrintCardMessage(message, isSuccess = true) {
    const box = document.getElementById('ajaxPrintCardMessage');

    if (!box) return;

    box.textContent = message || '';
    box.style.display = 'block';
    box.style.borderColor = isSuccess ? 'rgba(22,184,166,.4)' : 'rgba(153,27,27,.55)';
    box.style.background = isSuccess ? 'rgba(22,184,166,.12)' : 'rgba(153,27,27,.22)';
    box.style.color = isSuccess ? '#d1fae5' : '#fee2e2';

    clearTimeout(window.ajaxPrintCardMessageTimer);
    window.ajaxPrintCardMessageTimer = setTimeout(() => {
        box.style.display = 'none';
    }, 4000);
}

const printCardForm = document.getElementById('printCardForm');

if (printCardForm) {
    printCardForm.addEventListener('submit', function(event) {
        event.preventDefault();

        const submitButton = event.submitter || printCardForm.querySelector('button[type="submit"]');
        const originalText = submitButton ? submitButton.textContent : '';
        const replaceArtOnly = submitButton && submitButton.dataset && submitButton.dataset.mode === 'replace-art';
        const replaceInput = document.getElementById('pc_replace_art_only');

        if (replaceInput) {
            replaceInput.value = replaceArtOnly ? '1' : '0';
        }

        if (submitButton) {
            submitButton.textContent = replaceArtOnly ? 'Replacing Image...' : 'Creating...';
            submitButton.disabled = true;
        }

        const formData = new FormData(printCardForm);
        formData.set('ajax_create_print_card', '1');
        formData.set('replace_art_only', replaceArtOnly ? '1' : '0');

        fetch('index.php', {
            method: 'POST',
            body: formData,
            cache: 'no-store'
        })
        .then(response => response.json())
        .then(data => {
            if (!data.success) {
                throw new Error(data.message || 'Could not create print card.');
            }

            closePrintCardModal();

            openLatestPrintCard(data.path, data.f_number);

            showAjaxPrintCardMessage(data.message || 'Print card created successfully.', true);

            // Preserve current live search text and refresh the visible results.
            liveSearchGraphics();

            printCardForm.reset();
        })
        .catch(error => {
            console.error('Create print card error:', error);
            showAjaxPrintCardMessage(error.message || 'Could not create print card.', false);
        })
        .finally(() => {
            if (submitButton) {
                submitButton.textContent = originalText || (replaceArtOnly ? 'Replace Image Only / No Revision' : 'Create Print Card + Add Revision');
                submitButton.disabled = false;
            }
        });
    });
}

function closePrintCardModal() {
    document.getElementById('printCardModal').classList.remove('active');
}



function buildGm2DownloadUrl(filePath, downloadName) {
    const cleanPath = String(filePath || '').split('?')[0].split('#')[0];
    return 'index.php?gm2_download=1&file=' + encodeURIComponent(cleanPath) + '&name=' + encodeURIComponent(downloadName || cleanPath.split('/').pop() || 'download');
}

function getPrintCardDownloadFilename(fNumber) {
    const cleanF = String(fNumber || '').replace(/[^0-9]/g, '');
    return (cleanF || String(fNumber || '').trim() || 'print_card') + '.jpg';
}

function setLatestPrintCardDetails(details, fNumber) {
    details = details || {};

    const displayF = details.f_number || fNumber || '';
    const displayG = details.g_number || '';
    const displayD = details.d_number || '';
    const displayRev = details.rev || '';
    const displayDate = details.rev_date || '';
    const displayCsr = details.csr || '';
    const displayDes = details.des || '';
    const displayDescription = details.description || '';
    const displayCreated = details.created_at || '';

    const fields = {
        latestViewF: displayF,
        latestViewG: displayG,
        latestViewD: displayD,
        latestViewRev: displayRev,
        latestViewDate: displayDate,
        latestViewPeople: 'CSR: ' + displayCsr + ' / DES: ' + displayDes,
        latestViewDescription: displayDescription,
        latestViewCreated: displayCreated
    };

    Object.keys(fields).forEach(id => {
        const el = document.getElementById(id);
        if (el) el.textContent = fields[id] || '';
    });

    const editLink = document.getElementById('latestCardEditLink');
    if (editLink) {
        editLink.href = 'printcard_revisions.php?f_search=' + encodeURIComponent(displayF || fNumber || '') + '#tree_' + encodeURIComponent(String(displayF || fNumber || '').replace(/[^A-Za-z0-9]/g, ''));
    }
}

function openLatestPrintCard(src, fNumber) {
    const modal = document.getElementById('latestCardModal');
    const img = document.getElementById('latestCardImage');
    const download = document.getElementById('latestCardDownload');
    const title = document.getElementById('latestCardTitle');
    const subtitle = document.getElementById('latestCardSubtitle');

    if (title) title.textContent = 'Print Card Preview';
    if (subtitle) subtitle.textContent = 'Refreshing F# ' + fNumber + ' with latest revision data...';
    if (img) img.src = '';
    if (download) {
        download.href = '#';
        download.setAttribute('download', getPrintCardDownloadFilename(fNumber));
    }
    setLatestPrintCardDetails({ f_number: fNumber }, fNumber);

    if (modal) modal.classList.add('active');

    fetch('index.php?refresh_print_card=1&f_number=' + encodeURIComponent(fNumber), {
        cache: 'no-store'
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            throw new Error(data.message || 'Could not refresh print card.');
        }

        const refreshedSrc = data.path || src;
        const cacheBuster = refreshedSrc + '?v=' + (data.version || Date.now());

        if (img) img.src = cacheBuster;
        if (download) {
            download.href = buildGm2DownloadUrl(refreshedSrc, getPrintCardDownloadFilename(data.f_number || fNumber));
        }

        setLatestPrintCardDetails(data.details || { f_number: data.f_number || fNumber }, data.f_number || fNumber);

        if (subtitle) subtitle.textContent = 'F# ' + (data.f_number || fNumber) + ' — refreshed with latest revision data';
    })
    .catch(error => {
        console.error('Refresh print card error:', error);

        const fallbackSrc = src + '?v=' + Date.now();

        if (img) img.src = fallbackSrc;
        if (download) {
            download.href = buildGm2DownloadUrl(src, getPrintCardDownloadFilename(fNumber));
        }

        setLatestPrintCardDetails({ f_number: fNumber }, fNumber);
        if (subtitle) subtitle.textContent = 'F# ' + fNumber + ' — could not refresh automatically: ' + error.message;
    });
}

function closeLatestPrintCard() {
    const modal = document.getElementById('latestCardModal');
    const img = document.getElementById('latestCardImage');

    if (modal) {
        modal.classList.remove('active');
    }

    if (img) {
        img.src = '';
    }
}


function closeResultModal() {
    const modal = document.getElementById('printCardResultModal');
    if (modal) {
        modal.classList.remove('active');
    }
}

// After a print card is created, the page uses URL parameters to open the popup once.
// This removes those parameters so refreshing the page does NOT reopen the popup.
window.addEventListener('DOMContentLoaded', function() {
    const params = new URLSearchParams(window.location.search);

    if (params.has('created_print_card') || params.has('created_f')) {
        const cleanUrl = window.location.pathname;
        window.history.replaceState({}, document.title, cleanUrl);
    }
});

document.addEventListener('input', function(event) {
    if (event.target.classList && event.target.classList.contains('uppercase-input')) {
        const start = event.target.selectionStart;
        const end = event.target.selectionEnd;
        event.target.value = event.target.value.toUpperCase();
        if (typeof start === 'number' && typeof end === 'number') {
            event.target.setSelectionRange(start, end);
        }
    }
});
</script>

</body>
</html>