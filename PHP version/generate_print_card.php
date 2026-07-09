<?php
// generate_print_card.php

if ($_SERVER['REQUEST_METHOD'] !== 'POST') {
    die('Invalid request.');
}

function cleanNumberOnly($value) {
    return preg_replace('/[^0-9]/', '', $value ?? '');
}

function buildRevisionedGNumber($gNumber, $rev) {
    $cleanG = cleanNumberOnly($gNumber);
    $cleanRev = strtoupper(trim((string)($rev ?? '')));

    if ($cleanG === '') {
        return '';
    }

    if ($cleanRev === '' || $cleanRev === '0') {
        return $cleanG;
    }

    return $cleanG . '-' . $cleanRev;
}

$f_number = preg_replace('/[^0-9]/', '', $_POST['f_number'] ?? '');
$approval_pdf = $_POST['approval_pdf'] ?? '';

$rev = $_POST['rev'] ?? '';
$date = $_POST['date'] ?? date('n/j/y');
$description = $_POST['description'] ?? '';
$csr = $_POST['csr'] ?? '';
$des = $_POST['des'] ?? '';
$d_number = $_POST['d_number'] ?? '';
$g_number = $_POST['g_number'] ?? '';
$display_g_number = buildRevisionedGNumber($g_number, $rev);

if (!$f_number || !$approval_pdf || !file_exists($approval_pdf)) {
    die('Missing F# or approval PDF.');
}

$output_dir = __DIR__ . '/print_cards';
if (!is_dir($output_dir)) {
    mkdir($output_dir, 0777, true);
}

$output_file = $output_dir . '/' . $f_number . '.jpg';

// 300 DPI final print card size: 10" x 4"
$card_w = 3000;
$card_h = 1200;

// Info block: 1" x 4"
$info_w = 300;
$art_w = $card_w - $info_w;
$art_h = $card_h;

// Approval crop region at 300 DPI:
// Approval is 11" x 8.5"
// Crop is 10.5" x 5.5"
// X = .25", Y = 1.25"
$crop_x = 75;
$crop_y = 375;
$crop_w = 3150;
$crop_h = 1650;

try {
    // Render approval PDF page 1
    $approval = new Imagick();
    $approval->setResolution(300, 300);
    $approval->readImage($approval_pdf . '[0]');
    $approval->setImageColorspace(Imagick::COLORSPACE_RGB);
    $approval->setImageFormat('jpg');

    // Crop artwork from approval
    $approval->cropImage($crop_w, $crop_h, $crop_x, $crop_y);
    $approval->setImagePage(0, 0, 0, 0);

    // Resize artwork to fit 9" x 4" area
    $approval->resizeImage($art_w, $art_h, Imagick::FILTER_LANCZOS, 1, true);

    // Create final card
    $card = new Imagick();
    $card->newImage($card_w, $card_h, 'white');
    $card->setImageFormat('jpg');

    // Center artwork vertically/horizontally inside left area
    $art_actual_w = $approval->getImageWidth();
    $art_actual_h = $approval->getImageHeight();
    $art_x = intval(($art_w - $art_actual_w) / 2);
    $art_y = intval(($art_h - $art_actual_h) / 2);

    $card->compositeImage($approval, Imagick::COMPOSITE_OVER, $art_x, $art_y);

    // Draw info block
    $draw = new ImagickDraw();
    $draw->setStrokeColor('black');
    $draw->setFillColor('white');
    $draw->setStrokeWidth(3);

    $info_x = $art_w;
    $card->drawImage($draw);

    // Info block background/border
    $draw->rectangle($info_x, 0, $card_w - 1, $card_h - 1);

    // Header
    $draw->setFillColor('black');
    $draw->setFontSize(34);
    $draw->setStrokeWidth(1);
    $draw->annotation($info_x + 18, 45, 'PRINT CARD');

    $draw->setFontSize(26);
    $y = 95;

    $lines = [
        "F#: " . $f_number,
        "D#: " . $d_number,
        "G#: " . $display_g_number,
        "",
        "REV: " . $rev,
        "DATE: " . $date,
        "DESC:",
        $description,
        "",
        "CSR: " . $csr,
        "DES: " . $des,
    ];

    foreach ($lines as $line) {
        $draw->annotation($info_x + 18, $y, $line);
        $y += 38;
    }

    $card->drawImage($draw);

    // Save JPG
    $card->setImageCompressionQuality(95);
    $card->writeImage($output_file);

    echo "<h2>Print Card Created</h2>";
    echo "<p>File: <strong>" . htmlspecialchars($f_number) . ".jpg</strong></p>";
    echo "<p><a href='print_cards/" . htmlspecialchars($f_number) . ".jpg' download>Download Print Card</a></p>";
    echo "<p><img src='print_cards/" . htmlspecialchars($f_number) . ".jpg' style='max-width:100%;border:1px solid #ccc;'></p>";

} catch (Exception $e) {
    echo "Error creating print card: " . $e->getMessage();
}
?>
