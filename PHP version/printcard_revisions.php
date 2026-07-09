<?php
ini_set('display_errors', 1);
ini_set('display_startup_errors', 1);
error_reporting(E_ALL);

$db = new SQLite3('graphics.db');

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

$message = '';
$messageType = '';

function cleanNumber($value) {
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

function safeText($value) {
    return strtoupper(trim($value ?? ''));
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

function getLatestFourRevisionsForPrintCard($db, $fNumber) {
    $fNumber = cleanNumber($fNumber);

    if ($fNumber === '') {
        return [];
    }

    $stmt = $db->prepare("
        SELECT *
        FROM print_card_revisions
        WHERE f_number = :f_number
    ");
    $stmt->bindValue(':f_number', $fNumber);
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

    $final = imagecreatetruecolor($infoW, $cardH);
    $whiteFinal = imagecolorallocate($final, 255, 255, 255);
    $blackFinal = imagecolorallocate($final, 0, 0, 0);
    imagefilledrectangle($final, 0, 0, $infoW, $cardH, $whiteFinal);

    $font = findSystemFont(false);
    $fontBold = findSystemFont(true) ?: $font;

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

    drawPrintCardText($tableBase, 'REV', $x + 16, $y + 29, 15, $black, $fontBold);
    drawPrintCardText($tableBase, 'DATE', $colX[1] + 28, $y + 29, 15, $black, $fontBold);
    drawPrintCardText($tableBase, 'DESCRIPTION', $colX[2] + 180, $y + 29, 15, $black, $fontBold);
    drawPrintCardText($tableBase, 'CSR', $colX[3] + 38, $y + 29, 15, $black, $fontBold);
    drawPrintCardText($tableBase, 'DES', $colX[4] + 38, $y + 29, 15, $black, $fontBold);

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

    $rotated = imagerotate($tableBase, -90, $white);

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

    $latestRevisionRow = !empty($revisions) ? $revisions[count($revisions) - 1] : [];
    $latestPrintCardRev = $latestRevisionRow['rev'] ?? '';
    $latestApprovalRev = getLatestApprovalRevisionForPrintCard($db, $gNumber);
    $displayRevForArtIdentifier = $latestApprovalRev !== '' ? $latestApprovalRev : $latestPrintCardRev;
    $displayArtIdentifier = formatPrintCardArtIdentifier($gNumber, $displayRevForArtIdentifier);

    $idX = 28;
    $idY = $cardH - 155;

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
    $fNumber = cleanNumber($fNumber);

    if ($fNumber === '') {
        throw new Exception("Missing F#.");
    }

    $outputDir = __DIR__ . '/print_cards';
    $existingFile = $outputDir . '/' . $fNumber . '.jpg';

    if (!file_exists($existingFile)) {
        throw new Exception("Existing print card JPG not found for F# " . $fNumber . ".");
    }

    if (!function_exists('imagecreatefromjpeg')) {
        throw new Exception("PHP GD JPEG support is not enabled.");
    }

    $revisions = getLatestFourRevisionsForPrintCard($db, $fNumber);

    if (empty($revisions)) {
        throw new Exception("No revision records found for F# " . $fNumber . ".");
    }

    $latest = end($revisions);
    $gNumber = cleanArtIdentifier($latest['g_number'] ?? '');
    $dNumber = cleanAlphaNumber($latest['d_number'] ?? '');

    $cardW = 3000;
    $cardH = 1200;
    $infoW = 300;
    $artW = $cardW - $infoW;

    $source = imagecreatefromjpeg($existingFile);
    if (!$source) {
        throw new Exception("Could not open existing print card JPG.");
    }

    $tempInfo = $outputDir . '/refresh_info_' . $fNumber . '_' . time() . '.jpg';
    createInfoBlockWithGD($db, $tempInfo, $infoW, $cardH, $fNumber, $dNumber, $gNumber, $revisions);

    $info = imagecreatefromjpeg($tempInfo);
    if (!$info) {
        imagedestroy($source);
        @unlink($tempInfo);
        throw new Exception("Could not open regenerated info block.");
    }

    $final = imagecreatetruecolor($cardW, $cardH);
    $white = imagecolorallocate($final, 255, 255, 255);
    imagefilledrectangle($final, 0, 0, $cardW, $cardH, $white);

    imagecopyresampled(
        $final,
        $source,
        0,
        0,
        0,
        0,
        $artW,
        $cardH,
        min($artW, imagesx($source)),
        min($cardH, imagesy($source))
    );

    imagecopyresampled(
        $final,
        $info,
        $artW,
        0,
        0,
        0,
        $infoW,
        $cardH,
        imagesx($info),
        imagesy($info)
    );

    $tempFinal = $outputDir . '/refresh_final_' . $fNumber . '_' . time() . '.jpg';
    imagejpeg($final, $tempFinal, 95);

    imagedestroy($source);
    imagedestroy($info);
    imagedestroy($final);
    @unlink($tempInfo);

    if (!file_exists($tempFinal)) {
        throw new Exception("Could not rebuild print card JPG.");
    }

    if (!rename($tempFinal, $existingFile)) {
        @unlink($tempFinal);
        throw new Exception("Could not replace existing print card JPG.");
    }

    return 'print_cards/' . $fNumber . '.jpg';
}

if (isset($_GET['refresh_print_card']) && $_GET['refresh_print_card'] === '1') {
    header('Content-Type: application/json');

    try {
        $fNumber = cleanNumber($_GET['f_number'] ?? '');
        $path = regeneratePrintCardFromExistingJpg($db, $fNumber);

        echo json_encode([
            'success' => true,
            'path' => $path,
            'f_number' => $fNumber,
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


if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    if ($action === 'add_revision') {
        $g_number = cleanArtIdentifier($_POST['g_number'] ?? '');
        $f_number = cleanNumber($_POST['f_number'] ?? '');
        $d_number = cleanAlphaNumber($_POST['d_number'] ?? '');
        $rev = safeText($_POST['rev'] ?? '');
        $rev_date = safeText($_POST['rev_date'] ?? '');
        $description = safeText($_POST['description'] ?? '');
        $csr = safeText($_POST['csr'] ?? '');
        $des = safeText($_POST['des'] ?? '');

        if ($g_number === '' || $f_number === '') {
            $message = 'Missing G# or F# for the previous revision.';
            $messageType = 'error';
        } else {
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

            $message = 'Previous revision added for F# ' . htmlspecialchars($f_number) . '.';
            $messageType = 'success';
        }
    }

    if ($action === 'update_revision') {
        $id = intval($_POST['revision_id'] ?? 0);
        $g_number = cleanArtIdentifier($_POST['g_number'] ?? '');
        $f_number = cleanNumber($_POST['f_number'] ?? '');
        $d_number = cleanAlphaNumber($_POST['d_number'] ?? '');
        $rev = safeText($_POST['rev'] ?? '');
        $rev_date = safeText($_POST['rev_date'] ?? '');
        $description = safeText($_POST['description'] ?? '');
        $csr = safeText($_POST['csr'] ?? '');
        $des = safeText($_POST['des'] ?? '');

        if ($id <= 0 || $g_number === '' || $f_number === '') {
            $message = 'Missing required revision record information.';
            $messageType = 'error';
        } else {
            $stmt = $db->prepare("
                UPDATE print_card_revisions
                SET 
                    g_number = :g_number,
                    f_number = :f_number,
                    d_number = :d_number,
                    rev = :rev,
                    rev_date = :rev_date,
                    description = :description,
                    csr = :csr,
                    des = :des
                WHERE id = :id
            ");
            $stmt->bindValue(':g_number', $g_number);
            $stmt->bindValue(':f_number', $f_number);
            $stmt->bindValue(':d_number', $d_number);
            $stmt->bindValue(':rev', $rev);
            $stmt->bindValue(':rev_date', $rev_date);
            $stmt->bindValue(':description', $description);
            $stmt->bindValue(':csr', $csr);
            $stmt->bindValue(':des', $des);
            $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
            $stmt->execute();

            $message = 'Revision record updated for F# ' . htmlspecialchars($f_number) . '.';
            $messageType = 'success';
        }
    }

    if ($action === 'delete_revision') {
        $id = intval($_POST['revision_id'] ?? 0);

        if ($id <= 0) {
            $message = 'Missing revision record ID.';
            $messageType = 'error';
        } else {
            $stmt = $db->prepare("DELETE FROM print_card_revisions WHERE id = :id");
            $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
            $stmt->execute();

            $message = 'Revision record deleted.';
            $messageType = 'success';
        }
    }
}

$searchF = cleanNumber($_GET['f_search'] ?? '');
$totalResult = $db->querySingle("SELECT COUNT(*) FROM print_card_revisions");

if ($searchF !== '') {
    $stmt = $db->prepare("
        SELECT 
            f_number,
            MAX(g_number) AS g_number,
            MAX(d_number) AS d_number,
            COUNT(*) AS revision_count,
            MAX(id) AS latest_id
        FROM print_card_revisions
        WHERE f_number = :f_number
        GROUP BY f_number
        ORDER BY latest_id DESC
    ");
    $stmt->bindValue(':f_number', $searchF);
    $groupsResult = $stmt->execute();
    $resultTitle = 'Print Card Revision Group for F# ' . htmlspecialchars($searchF);
} else {
    $groupsResult = $db->query("
        SELECT 
            f_number,
            MAX(g_number) AS g_number,
            MAX(d_number) AS d_number,
            COUNT(*) AS revision_count,
            MAX(id) AS latest_id
        FROM print_card_revisions
        GROUP BY f_number
        ORDER BY latest_id DESC
        LIMIT 50
    ");
    $resultTitle = 'Print Card Revision Groups';
}

$groups = [];
while ($group = $groupsResult->fetchArray(SQLITE3_ASSOC)) {
    $fNumber = $group['f_number'];

    $revStmt = $db->prepare("
        SELECT id, g_number, f_number, d_number, rev, rev_date, description, csr, des, created_at
        FROM print_card_revisions
        WHERE f_number = :f_number
        ORDER BY 
            CASE 
                WHEN rev GLOB '[0-9]*' THEN CAST(rev AS INTEGER)
                ELSE 9999
            END ASC,
            rev ASC,
            id ASC
    ");
    $revStmt->bindValue(':f_number', $fNumber);
    $revResult = $revStmt->execute();

    $revisions = [];
    $latest = null;

    while ($row = $revResult->fetchArray(SQLITE3_ASSOC)) {
        $revisions[] = $row;
        $latest = $row;
    }

    $groups[] = [
        'summary' => $group,
        'latest' => $latest,
        'revisions' => $revisions
    ];
}
?>

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/gm2-base.css?v=<?php echo filemtime('assets/css/gm2-base.css'); ?>">
<link rel="stylesheet" href="assets/css/gm2-printcard-revisions.css?v=<?php echo filemtime('assets/css/gm2-printcard-revisions.css'); ?>">
<title>Print Card Revisions</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">

</head>

<body class="printcard-revisions-page">
<div class="wrapper">
        <header>
        <img class="app-logo" src="SUMTER HC-LOGO-HORIZONTAL-web.png" alt="Logo">
        <h1>Print Card Revisions</h1>
        <p class="subtitle">Search by F#, expand grouped revisions, view or edit one revision at a time.</p>

        <nav class="page-nav" aria-label="Page navigation">
            <a href="index.php">G# List</a>
       <!-- <a href="create_approval.php">Create Approval</a> -->
            <a class="active" href="printcard_revisions.php">Print Card Revisions</a>
        </nav>

        <div class="gm2-stat-strip printcard-stat-strip" aria-label="Print card revision stats">
            <div class="gm2-stat-item">
                <span class="gm2-stat-label">Records</span>
                <span class="gm2-stat-value"><?php echo intval($totalResult); ?></span>
            </div>
            <div class="gm2-stat-item">
                <span class="gm2-stat-label">Groups Shown</span>
                <span class="gm2-stat-value"><?php echo count($groups); ?></span>
            </div>
            <div class="gm2-stat-item">
                <span class="gm2-stat-label">Search</span>
                <span class="gm2-stat-value"><?php echo $searchF !== '' ? 'F#' . htmlspecialchars($searchF) : 'All'; ?></span>
            </div>
        </div>
                <a class="admin-corner-link" href="admin.php">Admin</a>

    </header>

    <?php if ($message): ?>
        <div class="message gm2-message <?php echo htmlspecialchars($messageType); ?>">
            <?php echo $message; ?>
        </div>
    <?php endif; ?>

    <section class="card gm-card printcard-search-card">
        <div class="gm2-section-kicker">Search</div>
        <div class="printcard-card-header-row">
            <div>
                <h2>Print Card Revisions</h2>
            </div>
        </div>

        <form method="GET" class="search-row printcard-search-row" id="revisionSearchForm">
            <div class="printcard-search-field">
                
                <input type="text" name="f_search" id="revisionLiveSearch" value="<?php echo htmlspecialchars($searchF); ?>" placeholder="TYPE F#, G#, D#, REV, DESCRIPTION, CSR, OR DES" autocomplete="off">
            </div>

            <button type="submit" class="gm-btn gm-btn-primary">Search F#</button>
            <button type="button" class="gm-btn gm-btn-secondary" onclick="printDisplayedRevisionGroups()">Print Results</button>
            <a class="button-link secondary gm-btn gm-btn-secondary" href="printcard_revisions.php">Show All</a>
        </form>
    </section>

    <section class="card gm-card printcard-results-card">
        <div class="printcard-results-header">
            <div>
                <div class="gm2-section-kicker">Revision Groups</div>
                <h2><?php echo $resultTitle; ?></h2>
            </div>
            <p class="muted printcard-results-help">Expand an F# group to view, edit, delete, or add historical revision records.</p>
        </div>

        <?php if (empty($groups)): ?>
            <p class="muted">No revision records found.</p>
        <?php else: ?>
            <div class="tree">
                <?php foreach ($groups as $group): 
                    $summary = $group['summary'];
                    $latest = $group['latest'];
                    $revisions = $group['revisions'];
                    $treeId = 'tree_' . preg_replace('/[^A-Za-z0-9]/', '', $summary['f_number']);
                ?>
                    <?php
                        $searchBlob = ($summary['f_number'] ?? '') . ' ' . ($summary['g_number'] ?? '') . ' ' . ($summary['d_number'] ?? '');

                        foreach ($revisions as $searchRev) {
                            $searchBlob .= ' ' . ($searchRev['rev'] ?? '') . ' ' . ($searchRev['rev_date'] ?? '') . ' ' . ($searchRev['description'] ?? '') . ' ' . ($searchRev['csr'] ?? '') . ' ' . ($searchRev['des'] ?? '');
                        }
                    ?>
                    <div class="tree-item" id="<?php echo htmlspecialchars($treeId); ?>" data-search="<?php echo htmlspecialchars(strtoupper($searchBlob), ENT_QUOTES); ?>">
                        <div class="tree-summary" onclick="toggleTree('<?php echo htmlspecialchars($treeId); ?>')">
                            <div class="arrow">▶</div>

                            <div>
                                <span class="summary-label">F#</span>
                                <span class="summary-value highlight"><?php echo htmlspecialchars($summary['f_number']); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">G#</span>
                                <span class="summary-value"><?php echo htmlspecialchars($summary['g_number']); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">D#</span>
                                <span class="summary-value"><?php echo htmlspecialchars($summary['d_number']); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">Revisions</span>
                                <span class="summary-value"><?php echo intval($summary['revision_count']); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">Latest</span>
                                <span class="summary-value">
                                    Rev <?php echo htmlspecialchars($latest['rev'] ?? ''); ?> — 
                                    <?php echo htmlspecialchars($latest['rev_date'] ?? ''); ?>
                                </span>
                            </div>

                            <div>
                                <button type="button" class="gm-btn gm-btn-secondary gm-btn-compact" onclick="event.stopPropagation(); toggleTree('<?php echo htmlspecialchars($treeId); ?>')">Open</button>
                            </div>
                        </div>

                        <div class="tree-details">
                            <div class="section-actions">
                                <button 
                                    type="button" 
                                    onclick="toggleAddPrevious('add_prev_<?php echo htmlspecialchars($treeId); ?>')"
                                 class="gm-btn gm-btn-primary">
                                    Add Previous Revision
                                </button>
                            </div>

                            <div class="add-previous-panel" id="add_prev_<?php echo htmlspecialchars($treeId); ?>">
                                <form method="POST">
                                    <input type="hidden" name="action" value="add_revision">

                                    <div class="edit-grid">
                                        <div>
                                            <label>G#</label>
                                            <input 
                                                type="text" 
                                                name="g_number" 
                                                value="<?php echo htmlspecialchars($summary['g_number']); ?>" 
                                                required
                                            >
                                        </div>

                                        <div>
                                            <label>F#</label>
                                            <input 
                                                type="text" 
                                                name="f_number" 
                                                value="<?php echo htmlspecialchars($summary['f_number']); ?>" 
                                                required
                                            >
                                        </div>

                                        <div>
                                            <label>D#</label>
                                            <input 
                                                type="text" 
                                                name="d_number" 
                                                value="<?php echo htmlspecialchars($summary['d_number']); ?>"
                                            >
                                        </div>

                                        <div>
                                            <label>Rev #</label>
                                            <input 
                                                type="text" 
                                                name="rev" 
                                                placeholder="Example: 0, 1, 2, A"
                                            >
                                        </div>

                                        <div>
                                            <label>Date</label>
                                            <input 
                                                type="text" 
                                                name="rev_date" 
                                                placeholder="Example: 5/19/26"
                                            >
                                        </div>

                                        <div>
                                            <label>CSR</label>
                                            <input 
                                                type="text" 
                                                name="csr" 
                                                placeholder="CSR initials"
                                            >
                                        </div>

                                        <div>
                                            <label>DES</label>
                                            <input 
                                                type="text" 
                                                name="des" 
                                                placeholder="Designer initials"
                                            >
                                        </div>

                                        <div class="wide">
                                            <label>Description</label>
                                            <textarea 
                                                name="description" 
                                                placeholder="Example: OLD REVISION FROM PREVIOUS SYSTEM"
                                            ></textarea>
                                        </div>
                                    </div>

                                    <div class="edit-actions">
                                        <button type="submit" class="gm-btn gm-btn-primary">Add Previous Revision</button>
                                        <button 
                                            type="button" 
                                            class="gm-btn gm-btn-secondary" 
                                            onclick="toggleAddPrevious('add_prev_<?php echo htmlspecialchars($treeId); ?>')"
                                        >
                                            Cancel
                                        </button>
                                    </div>
                                </form>

                                <p class="muted gm-no-margin-bottom">
                                    This adds a historical revision record to the selected F# group. It updates the revision history data, but it does not automatically redraw an already-created JPG print card.
                                </p>
                            </div>

                            <div class="revision-list">
                                <?php foreach ($revisions as $row): 
                                    $editId = 'edit_' . intval($row['id']);
                                ?>
                                    <div>
                                        <div class="revision-line">
                                            <span><strong>Rev:</strong> <?php echo htmlspecialchars($row['rev']); ?></span>
                                            <span><strong>Date:</strong> <?php echo htmlspecialchars($row['rev_date']); ?></span>
                                            <span class="revision-desc"><strong>Desc:</strong> <?php echo htmlspecialchars($row['description']); ?></span>
                                            <span><strong>CSR:</strong> <?php echo htmlspecialchars($row['csr']); ?></span>
                                            <span><strong>DES:</strong> <?php echo htmlspecialchars($row['des']); ?></span>

                                            <div class="revision-actions">
                                                <button 
                                                    type="button" 
                                                    class="gm-btn gm-btn-secondary"
                                                    onclick="openRevisionView(
                                                        '<?php echo htmlspecialchars($row['f_number'], ENT_QUOTES); ?>',
                                                        'print_cards/<?php echo htmlspecialchars($row['f_number'], ENT_QUOTES); ?>.jpg',
                                                        '<?php echo htmlspecialchars($row['g_number'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['d_number'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['rev'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['rev_date'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['description'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['csr'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['des'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['created_at'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($editId, ENT_QUOTES); ?>'
                                                    )">
                                                    View
                                                </button>

                                                <button type="button" class="gm-btn gm-btn-primary" onclick="toggleEdit('<?php echo htmlspecialchars($editId); ?>')">Edit</button>

                                                <form method="POST" onsubmit="return confirm('Delete this single revision record?');">
                                                    <input type="hidden" name="action" value="delete_revision">
                                                    <input type="hidden" name="revision_id" value="<?php echo intval($row['id']); ?>">
                                                    <button type="submit" class="danger gm-btn gm-btn-danger">Delete</button>
                                                </form>
                                            </div>
                                        </div>

                                        <div class="edit-panel" id="<?php echo htmlspecialchars($editId); ?>">
                                            <form method="POST">
                                                <input type="hidden" name="action" value="update_revision">
                                                <input type="hidden" name="revision_id" value="<?php echo intval($row['id']); ?>">

                                                <div class="edit-grid">
                                                    <div>
                                                        <label>G#</label>
                                                        <input type="text" name="g_number" value="<?php echo htmlspecialchars($row['g_number']); ?>" required>
                                                    </div>

                                                    <div>
                                                        <label>F#</label>
                                                        <input type="text" name="f_number" value="<?php echo htmlspecialchars($row['f_number']); ?>" required>
                                                    </div>

                                                    <div>
                                                        <label>D#</label>
                                                        <input type="text" name="d_number" value="<?php echo htmlspecialchars($row['d_number']); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Rev #</label>
                                                        <input type="text" name="rev" value="<?php echo htmlspecialchars($row['rev']); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Date</label>
                                                        <input type="text" name="rev_date" value="<?php echo htmlspecialchars($row['rev_date']); ?>">
                                                    </div>

                                                    <div>
                                                        <label>CSR</label>
                                                        <input type="text" name="csr" value="<?php echo htmlspecialchars($row['csr']); ?>">
                                                    </div>

                                                    <div>
                                                        <label>DES</label>
                                                        <input type="text" name="des" value="<?php echo htmlspecialchars($row['des']); ?>">
                                                    </div>

                                                    <div class="wide">
                                                        <label>Description</label>
                                                        <textarea name="description"><?php echo htmlspecialchars($row['description']); ?></textarea>
                                                    </div>
                                                </div>

                                                <div class="edit-actions">
                                                    <button type="submit" class="gm-btn gm-btn-primary">Save Revision</button>
                                                    <button type="button" class="secondary gm-btn gm-btn-secondary" onclick="toggleEdit('<?php echo htmlspecialchars($editId); ?>')">Cancel</button>
                                                </div>
                                            </form>
                                        </div>
                                    </div>
                                <?php endforeach; ?>
                            </div>
                        </div>
                    </div>
                <?php endforeach; ?>
            </div>
            <p id="revisionNoResults" class="muted gm-hidden">No matching revision groups found.</p>
        <?php endif; ?>
    </section>
</div>

<div id="revisionViewModal" class="view-modal printcard-preview-modal" onclick="closeRevisionView()">
    <div class="view-box gm-card printcard-preview-box" onclick="event.stopPropagation()">
        <button type="button" class="close-modal" onclick="closeRevisionView()">×</button>

        <div class="printcard-preview-header">
            <div>
                <h2>Print Card Preview</h2>
                <p class="muted" id="viewSubtitle"></p>
            </div>
        </div>

        <div class="printcard-preview-layout">
            <div class="view-image-wrap printcard-preview-image-panel">
                <img id="viewImage" class="view-image printcard-preview-image" src="" alt="Revision Print Card">
            </div>

            <aside class="printcard-preview-info-panel" aria-label="Print card details">
                <div class="view-grid printcard-preview-info-grid">
                    <div class="view-field">
                        <span class="view-label">F#</span>
                        <span class="view-value" id="viewF"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">G#</span>
                        <span class="view-value" id="viewG"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">D#</span>
                        <span class="view-value" id="viewD"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">Revision</span>
                        <span class="view-value" id="viewRev"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">Date</span>
                        <span class="view-value" id="viewDate"></span>
                    </div>

                    <div class="view-field">
                        <span class="view-label">CSR / DES</span>
                        <span class="view-value" id="viewPeople"></span>
                    </div>

                    <div class="view-field wide">
                        <span class="view-label">Description</span>
                        <span class="view-value" id="viewDescription"></span>
                    </div>

                    <div class="view-field wide">
                        <span class="view-label">Created</span>
                        <span class="view-value" id="viewCreated"></span>
                    </div>
                </div>

                <div class="printcard-preview-actions">
                    <a id="viewDownloadLink" class="gm-btn gm-btn-secondary" href="#" download>Download Image</a>
                    <a id="viewEditLink" class="gm-btn gm-btn-primary" href="#">Edit Print Card</a>
                </div>
            </aside>
        </div>
    </div>
</div>

<script>
function toggleTree(id) {
    const item = document.getElementById(id);
    if (item) {
        item.classList.toggle('open');
    }
}

function toggleEdit(id) {
    const panel = document.getElementById(id);
    if (panel) {
        panel.classList.toggle('active');
    }
}

function toggleAddPrevious(id) {
    const panel = document.getElementById(id);
    if (panel) {
        panel.classList.toggle('active');
    }
}


function getPrintCardTreeId(f) {
    return 'tree_' + String(f || '').replace(/[^A-Za-z0-9]/g, '');
}

function openRevisionView(f, imagePath, g, d, rev, revDate, description, csr, des, created, editId) {
    document.getElementById('viewF').textContent = f || '';
    document.getElementById('viewG').textContent = g || '';
    document.getElementById('viewD').textContent = d || '';
    document.getElementById('viewRev').textContent = rev || '';
    document.getElementById('viewDate').textContent = revDate || '';
    document.getElementById('viewDescription').textContent = description || '';
    document.getElementById('viewPeople').textContent = 'CSR: ' + (csr || '') + ' / DES: ' + (des || '');
    document.getElementById('viewCreated').textContent = created || '';
    document.getElementById('viewSubtitle').textContent = 'Refreshing F# ' + (f || '') + ' with latest revision data...';

    const image = document.getElementById('viewImage');
    const downloadLink = document.getElementById('viewDownloadLink');
    const editLink = document.getElementById('viewEditLink');
    const initialPath = imagePath || ('print_cards/' + encodeURIComponent(f || '') + '.jpg');

    if (image) {
        image.src = '';
    }

    if (downloadLink) {
        downloadLink.href = initialPath;
        downloadLink.setAttribute('download', 'F' + (f || '') + '_print_card.jpg');
    }

    if (editLink) {
        const treeId = getPrintCardTreeId(f);
        editLink.href = 'printcard_revisions.php?f_search=' + encodeURIComponent(f || '') + '#' + treeId;
        editLink.onclick = function(event) {
            event.preventDefault();
            closeRevisionView();

            const tree = document.getElementById(treeId);
            const editPanel = editId ? document.getElementById(editId) : null;

            if (tree) {
                tree.classList.add('open');
            }

            if (editPanel) {
                editPanel.classList.add('active');
            }

            const target = editPanel || tree;
            if (target) {
                setTimeout(function() {
                    target.scrollIntoView({ behavior: 'smooth', block: 'center' });
                }, 50);
            } else {
                window.location.href = editLink.href;
            }
        };
    }

    document.getElementById('revisionViewModal').classList.add('active');

    fetch('printcard_revisions.php?refresh_print_card=1&f_number=' + encodeURIComponent(f), {
        cache: 'no-store'
    })
    .then(response => response.json())
    .then(data => {
        if (!data.success) {
            throw new Error(data.message || 'Could not refresh print card.');
        }

        const refreshedPath = data.path || imagePath;

        if (image) {
            image.src = refreshedPath + '?v=' + (data.version || Date.now());
        }

        if (downloadLink) {
            downloadLink.href = refreshedPath + '?v=' + (data.version || Date.now());
            downloadLink.setAttribute('download', 'F' + (f || '') + '_print_card.jpg');
        }

        document.getElementById('viewSubtitle').textContent = 'F# ' + (f || '') + ' — refreshed with latest revision data';
    })
    .catch(error => {
        console.error('Refresh print card error:', error);

        if (image) {
            image.src = initialPath + '?v=' + Date.now();
        }

        if (downloadLink) {
            downloadLink.href = initialPath + '?v=' + Date.now();
        }

        document.getElementById('viewSubtitle').textContent = 'F# ' + (f || '') + ' — could not refresh automatically: ' + error.message;
    });
}

function closeRevisionView() {
    document.getElementById('revisionViewModal').classList.remove('active');

    const image = document.getElementById('viewImage');
    if (image) {
        image.src = '';
    }
}


const revisionSearchForm = document.getElementById('revisionSearchForm');
const revisionLiveSearch = document.getElementById('revisionLiveSearch');

if (revisionSearchForm) {
    revisionSearchForm.addEventListener('submit', function(event) {
        event.preventDefault();
        filterRevisionGroups();
    });
}

if (revisionLiveSearch) {
    revisionLiveSearch.addEventListener('input', filterRevisionGroups);
}

function filterRevisionGroups() {
    const q = (revisionLiveSearch ? revisionLiveSearch.value : '').trim().toUpperCase();
    const items = Array.from(document.querySelectorAll('.tree-item'));
    let shown = 0;

    items.forEach(item => {
        const haystack = item.getAttribute('data-search') || '';
        const isMatch = q === '' || haystack.includes(q);

        item.style.display = isMatch ? '' : 'none';

        if (isMatch) {
            shown++;
        }
    });

    const noResults = document.getElementById('revisionNoResults');
    if (noResults) {
        noResults.style.display = shown === 0 ? 'block' : 'none';
    }
}

function printDisplayedRevisionGroups() {
    const visibleItems = Array.from(document.querySelectorAll('.tree-item'))
        .filter(item => item.style.display !== 'none');

    const searchText = revisionLiveSearch ? revisionLiveSearch.value.trim() : '';

    let rows = '';

    visibleItems.forEach(item => {
        const summaryValues = item.querySelectorAll('.tree-summary .summary-value');
        const f = summaryValues[0] ? summaryValues[0].innerText.trim() : '';
        const g = summaryValues[1] ? summaryValues[1].innerText.trim() : '';
        const d = summaryValues[2] ? summaryValues[2].innerText.trim() : '';
        const count = summaryValues[3] ? summaryValues[3].innerText.trim() : '';
        const latest = summaryValues[4] ? summaryValues[4].innerText.trim() : '';

        rows += `
            <tr>
                <td>${escapePrintHtml(f)}</td>
                <td>${escapePrintHtml(g)}</td>
                <td>${escapePrintHtml(d)}</td>
                <td>${escapePrintHtml(count)}</td>
                <td>${escapePrintHtml(latest)}</td>
            </tr>
        `;
    });

    if (!rows) {
        rows = '<tr><td colspan="5">No displayed results to print.</td></tr>';
    }

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Print Card Revision Report</title>
            <style>
                body { font-family: Arial, Helvetica, sans-serif; color: #111; padding: 24px; }
                h1 { margin: 0 0 6px; font-size: 24px; }
                p { margin: 0 0 18px; color: #555; }
                table { width: 100%; border-collapse: collapse; }
                th, td { border: 1px solid #999; padding: 8px; font-size: 12px; text-align: left; }
                th { background: #eee; }
            </style>
        </head>
        <body>
            <h1>Print Card Revision Report</h1>
            <p>${searchText ? 'Displayed search results for: ' + escapePrintHtml(searchText) : 'All displayed revision groups'}</p>
            <table>
                <thead>
                    <tr>
                        <th>F#</th>
                        <th>G#</th>
                        <th>D#</th>
                        <th>Revision Count</th>
                        <th>Latest Revision</th>
                    </tr>
                </thead>
                <tbody>${rows}</tbody>
            </table>
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    printWindow.print();
}

function escapePrintHtml(value) {
    return String(value ?? '')
        .replace(/&/g, '&amp;')
        .replace(/</g, '&lt;')
        .replace(/>/g, '&gt;')
        .replace(/"/g, '&quot;')
        .replace(/'/g, '&#039;');
}


document.addEventListener('input', function(event) {
    if (event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') {
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
