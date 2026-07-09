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

// Safety migration for older approval_revisions tables.
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
$messageType = '';
$regeneratedApprovalWeb = '';
$regeneratedApprovalG = '';

function cleanNumber($value) {
    return preg_replace('/[^0-9]/', '', $value ?? '');
}

function safeText($value) {
    return strtoupper(trim($value ?? ''));
}

function safeWebPath($path) {
    $path = trim((string)$path);
    $path = str_replace(['../', '..\\'], '', $path);
    return $path;
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
    if (function_exists('safeWebPath')) {
        return safeWebPath($path);
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
function checkboxTextValue($name) {
    return isset($_POST[$name]) ? '1' : '0';
}

function isCheckedValue($value) {
    $value = strtoupper(trim((string)$value));
    return in_array($value, ['1', 'YES', 'ON', 'TRUE'], true);
}

function buildRevisionedGNumberForApproval($gNumber, $rev) {
    $cleanG = cleanNumber($gNumber);
    $cleanRev = strtoupper(trim((string)($rev ?? '')));

    if ($cleanG === '') {
        return '';
    }

    if ($cleanRev === '' || $cleanRev === '0') {
        return $cleanG;
    }

    return $cleanG . '-' . $cleanRev;
}

function saveSnapshotUpload($file, $gNumber, $rev) {
    if (!isset($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return '';
    }

    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK || empty($file['tmp_name'])) {
        throw new Exception('Snapshot upload failed.');
    }

    $originalName = $file['name'] ?? 'snapshot';
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $allowed = ['jpg', 'jpeg', 'png', 'webp'];

    if (!in_array($ext, $allowed, true)) {
        throw new Exception('Snapshot must be a JPG, JPEG, PNG, or WEBP image.');
    }

    $dir = __DIR__ . '/approval_snapshots';
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }
    @chmod($dir, 0777);

    $cleanRev = preg_replace('/[^A-Z0-9_-]/i', '', (string)$rev);
    if ($cleanRev === '') {
        $cleanRev = 'REV';
    }

    $filename = $gNumber . '_rev' . $cleanRev . '_' . time() . '.' . $ext;
    $fullPath = $dir . '/' . $filename;

    if (!move_uploaded_file($file['tmp_name'], $fullPath)) {
        throw new Exception('Could not save uploaded snapshot.');
    }

    return 'approval_snapshots/' . $filename;
}



function findPythonBinaryForApprovalRevisionArt() {
    $candidates = [
        '/Library/Developer/CommandLineTools/usr/bin/python3',
        '/opt/homebrew/bin/python3',
        '/usr/local/bin/python3',
        '/usr/bin/python3'
    ];

    foreach ($candidates as $candidate) {
        if (file_exists($candidate) && is_executable($candidate)) {
            return $candidate;
        }
    }

    $whichOutput = [];
    $whichReturn = 1;
    exec('PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin which python3 2>&1', $whichOutput, $whichReturn);

    if ($whichReturn === 0 && !empty($whichOutput[0]) && file_exists(trim($whichOutput[0]))) {
        return trim($whichOutput[0]);
    }

    return '';
}

function saveApprovalRevisionArtworkUpload($file, $gNumber, $rev) {
    if (!isset($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return '';
    }

    if (($file['error'] ?? UPLOAD_ERR_OK) !== UPLOAD_ERR_OK || empty($file['tmp_name'])) {
        throw new Exception('Replacement approval artwork upload failed.');
    }

    $originalName = $file['name'] ?? 'approval_artwork';
    $ext = strtolower(pathinfo($originalName, PATHINFO_EXTENSION));
    $allowed = ['pdf', 'jpg', 'jpeg', 'png'];

    if (!in_array($ext, $allowed, true)) {
        throw new Exception('Replacement approval artwork must be a PDF, JPG, JPEG, or PNG.');
    }

    $dir = __DIR__ . '/approval_uploads';
    if (!is_dir($dir)) {
        mkdir($dir, 0777, true);
    }
    @chmod($dir, 0777);

    $cleanRev = preg_replace('/[^A-Z0-9_-]/i', '', (string)$rev);
    if ($cleanRev === '') {
        $cleanRev = 'REV';
    }

    $filename = $gNumber . '_rev' . $cleanRev . '_replacement_art_' . time() . '.' . $ext;
    $fullPath = $dir . '/' . $filename;

    if (!move_uploaded_file($file['tmp_name'], $fullPath)) {
        throw new Exception('Could not save replacement approval artwork.');
    }

    return $fullPath;
}

function clearApprovalArtworkAreaOnApprovalPdfForRevision($basePdfPath, $clearedPdfPath, $artBox) {
    if (!file_exists($basePdfPath)) {
        throw new Exception('Existing approval PDF was not found before clearing artwork area.');
    }

    $python = findPythonBinaryForApprovalRevisionArt();
    if (!$python) {
        throw new Exception('python3 was not found, so the approval artwork area could not be cleared.');
    }

    $tempDir = __DIR__ . '/magick_tmp';
    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }
    @chmod($tempDir, 0777);

    $helperScript = $tempDir . '/clear_approval_art_box.py';

    $script = <<<'PYHELPER'
import argparse
import sys

try:
    from pypdf import PdfReader, PdfWriter, PageObject
    from pypdf.generic import DecodedStreamObject, NameObject, DictionaryObject
except Exception as exc:
    sys.stderr.write('Could not import pypdf: %s\n' % exc)
    sys.exit(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--box', required=True)
    args = parser.parse_args()

    try:
        x, y, w, h = [float(part.strip()) for part in args.box.split(',')]
    except Exception:
        sys.stderr.write('Invalid art box. Expected x,y,width,height.\n')
        sys.exit(3)

    # Add a tiny bleed inside the approval art box so old artwork edges do not show.
    # This still stays inside the same artwork area used by Create Approval.
    bleed = 1.0
    x = x - bleed
    y = y - bleed
    w = w + (bleed * 2)
    h = h + (bleed * 2)

    reader = PdfReader(args.base)
    writer = PdfWriter()

    for index, page in enumerate(reader.pages):
        if index == 0:
            page_width = float(page.mediabox.width)
            page_height = float(page.mediabox.height)

            overlay = PageObject.create_blank_page(width=page_width, height=page_height)
            stream = DecodedStreamObject()
            stream.set_data((
                'q\n'
                '1 1 1 rg\n'
                '1 1 1 RG\n'
                f'{x:.3f} {y:.3f} {w:.3f} {h:.3f} re\n'
                'f\n'
                'Q\n'
            ).encode('utf-8'))
            overlay[NameObject('/Contents')] = stream
            overlay[NameObject('/Resources')] = DictionaryObject()

            page.merge_page(overlay)

        writer.add_page(page)

    with open(args.out, 'wb') as handle:
        writer.write(handle)


if __name__ == '__main__':
    main()
PYHELPER;

    if (file_put_contents($helperScript, $script) === false) {
        throw new Exception('Could not create temporary artwork clearing helper script.');
    }

    $cmd =
        'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
        escapeshellcmd($python) . ' ' .
        escapeshellarg($helperScript) . ' ' .
        '--base ' . escapeshellarg($basePdfPath) . ' ' .
        '--out ' . escapeshellarg($clearedPdfPath) . ' ' .
        '--box ' . escapeshellarg($artBox) . ' ' .
        '2>&1';

    exec($cmd, $out, $ret);

    if ($ret !== 0 || !file_exists($clearedPdfPath) || filesize($clearedPdfPath) <= 0) {
        throw new Exception('Could not clear old artwork from approval PDF: ' . implode("\n", $out));
    }
}

function placeUploadedArtworkOnApprovalPdfForRevision($basePdfPath, $artworkPath, $finalPdfPath) {
    if (!file_exists($basePdfPath)) {
        throw new Exception('Existing approval PDF was not found before replacing artwork.');
    }

    if (!file_exists($artworkPath)) {
        throw new Exception('Replacement artwork file was not found.');
    }

    $python = findPythonBinaryForApprovalRevisionArt();
    if (!$python) {
        throw new Exception('python3 was not found, so the approval artwork could not be replaced.');
    }

    // Same artwork box used by Create Approval.
    // PDF coordinates start at bottom-left: x, y, width, height.
    $artBox = '26,150,740,385';

    $tempDir = __DIR__ . '/magick_tmp';
    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }
    @chmod($tempDir, 0777);

    $ext = strtolower(pathinfo($artworkPath, PATHINFO_EXTENSION));

    /*
        IMPORTANT:
        The older helper script placed artwork correctly, but it could strip the AcroForm
        from the output PDF. That made pdftk fail later with:
        "input PDF is not an acroform, so its fields were not filled."

        For PDF artwork, this inline pypdf helper preserves the original template AcroForm
        while merging the artwork into the approval art box.
    */
    if ($ext === 'pdf') {
        $helperScript = $tempDir . '/place_approval_art_preserve_form_' . uniqid('', true) . '.py';

        $script = <<<'PYHELPER'
import argparse
import sys

try:
    from pypdf import PdfReader, PdfWriter, Transformation
    from pypdf.generic import NameObject
except Exception as exc:
    sys.stderr.write('Could not import pypdf: %s\n' % exc)
    sys.exit(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--art', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--box', required=True)
    args = parser.parse_args()

    try:
        x, y, w, h = [float(part.strip()) for part in args.box.split(',')]
    except Exception:
        sys.stderr.write('Invalid art box. Expected x,y,width,height.\n')
        sys.exit(3)

    base_reader = PdfReader(args.base)
    art_reader = PdfReader(args.art)

    if len(base_reader.pages) < 1:
        sys.stderr.write('Base approval PDF has no pages.\n')
        sys.exit(4)

    if len(art_reader.pages) < 1:
        sys.stderr.write('Artwork PDF has no pages.\n')
        sys.exit(5)

    art_page = art_reader.pages[0]

    # Use the visible page box, not just the raw media box.
    # Some PDFs (especially cropped approval-art extracts) keep non-zero lower-left
    # coordinates. If we do not translate those coordinates back to 0,0 before scaling,
    # the artwork lands shifted/off-page inside the approval.
    visible_box = art_page.cropbox if art_page.cropbox is not None else art_page.mediabox
    art_llx = float(visible_box.left)
    art_lly = float(visible_box.bottom)
    art_urx = float(visible_box.right)
    art_ury = float(visible_box.top)
    art_w = art_urx - art_llx
    art_h = art_ury - art_lly

    if art_w <= 0 or art_h <= 0:
        sys.stderr.write('Artwork page has invalid dimensions.\n')
        sys.exit(6)

    scale = min(w / art_w, h / art_h)
    tx = x + ((w - (art_w * scale)) / 2.0)
    ty = y + ((h - (art_h * scale)) / 2.0)

    writer = PdfWriter()

    for index, page in enumerate(base_reader.pages):
        if index == 0:
            transform = (
                Transformation()
                .translate(-art_llx, -art_lly)
                .scale(scale)
                .translate(tx, ty)
            )
            page.merge_transformed_page(art_page, transform, over=True)
        writer.add_page(page)

    root = base_reader.trailer.get('/Root', {})
    if '/AcroForm' in root:
        # Preserve the fillable form structure so pdftk fill_form still works later.
        writer._root_object.update({NameObject('/AcroForm'): root['/AcroForm']})

    with open(args.out, 'wb') as handle:
        writer.write(handle)


if __name__ == '__main__':
    main()
PYHELPER;

        if (file_put_contents($helperScript, $script) === false) {
            throw new Exception('Could not create temporary artwork placement helper script.');
        }

        $cmd =
            'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
            escapeshellcmd($python) . ' ' .
            escapeshellarg($helperScript) . ' ' .
            '--base ' . escapeshellarg($basePdfPath) . ' ' .
            '--art ' . escapeshellarg($artworkPath) . ' ' .
            '--out ' . escapeshellarg($finalPdfPath) . ' ' .
            '--box ' . escapeshellarg($artBox) . ' ' .
            '2>&1';

        exec($cmd, $out, $ret);

        if (file_exists($helperScript)) {
            @unlink($helperScript);
        }

        if ($ret !== 0 || !file_exists($finalPdfPath) || filesize($finalPdfPath) <= 0) {
            throw new Exception('Could not replace artwork inside approval PDF while preserving form fields: ' . implode("\n", $out));
        }

        return;
    }

    // Non-PDF artwork still falls back to the original helper.
    $helperScript = __DIR__ . '/place_approval_art.py';
    if (!file_exists($helperScript)) {
        throw new Exception('Artwork placement helper was not found: ' . $helperScript);
    }

    $cmd =
        'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
        escapeshellcmd($python) . ' ' .
        escapeshellarg($helperScript) . ' ' .
        '--base ' . escapeshellarg($basePdfPath) . ' ' .
        '--art ' . escapeshellarg($artworkPath) . ' ' .
        '--out ' . escapeshellarg($finalPdfPath) . ' ' .
        '--box ' . escapeshellarg($artBox) . ' ' .
        '2>&1';

    exec($cmd, $out, $ret);

    if ($ret !== 0 || !file_exists($finalPdfPath) || filesize($finalPdfPath) <= 0) {
        throw new Exception('Could not replace artwork inside approval PDF: ' . implode("\n", $out));
    }
}


function replaceApprovalRevisionArtworkInPdf($approvalPdfWebPath, $file, $gNumber, $rev) {
    if (!isset($file) || ($file['error'] ?? UPLOAD_ERR_NO_FILE) === UPLOAD_ERR_NO_FILE) {
        return false;
    }

    $approvalPdfWebPath = safeWebPath($approvalPdfWebPath);

    if ($approvalPdfWebPath === '' || strtolower(pathinfo($approvalPdfWebPath, PATHINFO_EXTENSION)) !== 'pdf') {
        throw new Exception('This revision does not have a valid approval PDF path to update.');
    }

    // Keep this limited to folders managed by this tool.
    $allowedPdfFolder = (
        strpos($approvalPdfWebPath, 'approvals/') === 0 ||
        strpos($approvalPdfWebPath, 'approval_revisions_pdfs/') === 0
    );

    if (!$allowedPdfFolder) {
        throw new Exception('Approval artwork can only be replaced on PDFs stored in the approvals folders.');
    }

    $approvalPdfFullPath = __DIR__ . '/' . $approvalPdfWebPath;
    if (!file_exists($approvalPdfFullPath)) {
        throw new Exception('Existing approval PDF file does not exist: ' . $approvalPdfWebPath);
    }

    $uploadedArtworkFullPath = saveApprovalRevisionArtworkUpload($file, $gNumber, $rev);
    if ($uploadedArtworkFullPath === '') {
        return false;
    }

    $tempDir = __DIR__ . '/magick_tmp';
    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }
    @chmod($tempDir, 0777);

    $backupPath = $approvalPdfFullPath . '.before_art_replace_' . time() . '.bak';
    $tempOutput = $tempDir . '/approval_art_replace_' . $gNumber . '_' . time() . '.pdf';

    rebuildApprovalRevisionPdfFromCleanTemplateWithArtwork($approvalPdfFullPath, $uploadedArtworkFullPath, $tempOutput);

    if (!copy($approvalPdfFullPath, $backupPath)) {
        @unlink($tempOutput);
        throw new Exception('Could not create a safety backup before replacing approval artwork.');
    }

    if (!rename($tempOutput, $approvalPdfFullPath)) {
        @unlink($tempOutput);
        throw new Exception('Could not replace the approval PDF after updating artwork.');
    }

    return true;
}

function approvalFdfEscape($value) {
    $value = (string)$value;
    $value = str_replace('\\', '\\\\', $value);
    $value = str_replace('(', '\\(', $value);
    $value = str_replace(')', '\\)', $value);
    $value = str_replace(["\r\n", "\r", "\n"], '\\r', $value);
    return $value;
}

function writeApprovalRevisionFdf($fields, $fdfPath) {
    $fdf = "%FDF-1.2\n";
    $fdf .= "1 0 obj\n";
    $fdf .= "<<\n";
    $fdf .= "/FDF << /Fields [\n";

    foreach ($fields as $fieldName => $fieldValue) {
        $fdf .= "<< /T (" . approvalFdfEscape($fieldName) . ") /V (" . approvalFdfEscape($fieldValue) . ") >>\n";
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

function getSortedApprovalRevisionRows($db, $gNumber, $limit = 4) {
    $cleanG = cleanNumber($gNumber);

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

function buildRevisionOnlyFieldsForApprovalPdf($revisionRows, $gNumber = '') {
    $fields = [];

    $revisionRows = array_values(array_slice($revisionRows, -4));

    $currentRevisionRow = !empty($revisionRows) ? $revisionRows[count($revisionRows) - 1] : [];
    $currentRev = $currentRevisionRow['rev'] ?? '';
    $fields['ART #'] = buildRevisionedGNumberForApproval($gNumber, $currentRev);
    $fields['DESIGN #'] = strtoupper(trim((string)($currentRevisionRow['d_number'] ?? '')));

    for ($i = 0; $i < 4; $i++) {
        $row = $revisionRows[$i] ?? [];
        $fields['ART REV ' . $i] = strtoupper(trim((string)($row['rev'] ?? '')));
        $fields['rev date ' . $i] = strtoupper(trim((string)($row['rev_date'] ?? '')));
        $fields['DESCR ' . $i] = strtoupper(trim((string)($row['description'] ?? '')));
        $fields['CSR ' . $i] = strtoupper(trim((string)($row['csr'] ?? '')));
        $fields['DSR ' . $i] = strtoupper(trim((string)($row['dsr'] ?? '')));
    }

    return $fields;
}

function findPdftkForApprovalRevision() {
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

    return '';
}


function readApprovalPdfFieldsForRevisionRebuild($pdfFullPath) {
    if (!file_exists($pdfFullPath)) {
        throw new Exception('Approval PDF was not found for field extraction.');
    }

    $pdftk = findPdftkForApprovalRevision();
    if (!$pdftk) {
        throw new Exception('pdftk was not found, so approval fields could not be preserved.');
    }

    $cmd =
        'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
        escapeshellcmd($pdftk) . ' ' .
        escapeshellarg($pdfFullPath) . ' ' .
        'dump_data_fields_utf8 2>&1';

    exec($cmd, $out, $ret);

    if ($ret !== 0) {
        throw new Exception('Could not read current approval PDF fields: ' . implode("\n", $out));
    }

    $fields = [];
    $checkboxes = [];
    $currentName = null;
    $currentType = '';

    foreach ($out as $line) {
        if (strpos($line, '---') === 0) {
            $currentName = null;
            $currentType = '';
            continue;
        }

        if (strpos($line, 'FieldName:') === 0) {
            $currentName = trim(substr($line, strlen('FieldName:')));
            $currentType = '';
            if ($currentName !== '' && !array_key_exists($currentName, $fields)) {
                $fields[$currentName] = '';
            }
            continue;
        }

        if (strpos($line, 'FieldType:') === 0) {
            $currentType = trim(substr($line, strlen('FieldType:')));
            continue;
        }

        if (strpos($line, 'FieldValue:') === 0 && $currentName !== null) {
            $value = trim(substr($line, strlen('FieldValue:')));

            if (strtolower($currentType) === 'button') {
                $checkboxes[$currentName] = in_array(strtoupper($value), ['YES', 'ON', '1', 'TRUE'], true);
                unset($fields[$currentName]);
            } else {
                $fields[$currentName] = $value;
            }
        }
    }

    return [
        'fields' => $fields,
        'checkboxes' => $checkboxes
    ];
}


function getCurrentApprovalPdfWebPathForHydration($db, $gNumber, $existingApprovalPdf = '') {
    $cleanG = cleanNumber($gNumber);
    $existingApprovalPdf = safeWebPath($existingApprovalPdf);

    if ($existingApprovalPdf !== '' && strpos($existingApprovalPdf, 'approvals/') === 0 && strtolower(pathinfo($existingApprovalPdf, PATHINFO_EXTENSION)) === 'pdf') {
        return $existingApprovalPdf;
    }

    if ($cleanG === '') {
        return '';
    }

    $stmt = $db->prepare("\n        SELECT preview_image\n        FROM graphics\n        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number\n        LIMIT 1\n    ");
    $stmt->bindValue(':g_number', $cleanG);
    $graphic = $stmt->execute()->fetchArray(SQLITE3_ASSOC);
    $preview = safeWebPath($graphic['preview_image'] ?? '');

    if ($preview !== '' && strpos($preview, 'approvals/') === 0 && strtolower(pathinfo($preview, PATHINFO_EXTENSION)) === 'pdf') {
        return $preview;
    }

    return '';
}

function shouldHydrateApprovalRevisionRow($row) {
    // Older revisions with a snapshot are historical records. Do not pull newer/current PDF values into them.
    if (!empty($row['snapshot_image'])) {
        return false;
    }

    $metadataFields = [
        'customer_number',
        'customer_name',
        'spec_number',
        'item_description',
        'test_flute',
        'sales_rep',
        'approval_date',
        'digital_print',
        'digital_cut',
        'digital_die_cut',
        'label_die_cut',
        'label_4c_process'
    ];

    foreach ($metadataFields as $field) {
        if (trim((string)($row[$field] ?? '')) !== '') {
            return false;
        }
    }

    return true;
}

function hydrateCurrentRevisionFromPdfIfNeeded($db, $row) {
    if (!shouldHydrateApprovalRevisionRow($row)) {
        return $row;
    }

    $id = intval($row['id'] ?? 0);
    $cleanG = cleanNumber($row['g_number'] ?? '');

    if ($id <= 0 || $cleanG === '') {
        return $row;
    }

    $approvalPdfWeb = getCurrentApprovalPdfWebPathForHydration($db, $cleanG, $row['approval_pdf'] ?? '');
    if ($approvalPdfWeb === '') {
        return $row;
    }

    $approvalPdfFullPath = __DIR__ . '/' . $approvalPdfWeb;
    if (!file_exists($approvalPdfFullPath)) {
        return $row;
    }

    try {
        $fieldData = readApprovalPdfFieldsForRevisionRebuild($approvalPdfFullPath);
    } catch (Exception $e) {
        // Hydration should never break the page. If the PDF cannot be read, keep the row unchanged.
        return $row;
    }

    $pdfFields = $fieldData['fields'] ?? [];
    $pdfChecks = $fieldData['checkboxes'] ?? [];

    $hydrated = [
        'customer_number' => safeText($pdfFields['CUST #'] ?? ''),
        'customer_name' => safeText($pdfFields['CUSTOMER'] ?? ''),
        'spec_number' => safeText($pdfFields['SPEC #'] ?? ''),
        'd_number' => safeText(($row['d_number'] ?? '') !== '' ? $row['d_number'] : ($pdfFields['DESIGN #'] ?? '')),
        'item_description' => safeText($pdfFields['I.D'] ?? ''),
        'test_flute' => safeText($pdfFields['TEST'] ?? ''),
        'sales_rep' => safeText($pdfFields['Sales Rep'] ?? ''),
        'approval_date' => safeText($pdfFields['APPROVAL CREATION DATE'] ?? ''),
        'digital_print' => !empty($pdfChecks['Check Box DIGITAL PRINT']) ? '1' : '0',
        'digital_cut' => !empty($pdfChecks['Check Box DIGITAL CUT']) ? '1' : '0',
        'digital_die_cut' => !empty($pdfChecks['Check Box DIE CUT BAYSEK']) ? '1' : '0',
        'label_die_cut' => !empty($pdfChecks['Check Box DIE CUT LABEL']) ? '1' : '0',
        'label_4c_process' => !empty($pdfChecks['Check Box PROCESS']) ? '1' : '0',
        'approval_pdf' => $approvalPdfWeb
    ];

    // Fallback to the Graphics row for customer/description data if the PDF field extraction is incomplete.
    $graphicStmt = $db->prepare("\n        SELECT customer_number, customer_name, part_number\n        FROM graphics\n        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number\n        LIMIT 1\n    ");
    $graphicStmt->bindValue(':g_number', $cleanG);
    $graphic = $graphicStmt->execute()->fetchArray(SQLITE3_ASSOC);

    if ($graphic) {
        if ($hydrated['customer_number'] === '') {
            $hydrated['customer_number'] = safeText($graphic['customer_number'] ?? '');
        }
        if ($hydrated['customer_name'] === '') {
            $hydrated['customer_name'] = safeText($graphic['customer_name'] ?? '');
        }
        if ($hydrated['item_description'] === '') {
            $hydrated['item_description'] = safeText($graphic['part_number'] ?? '');
        }
    }

    $stmt = $db->prepare("\n        UPDATE approval_revisions\n        SET\n            customer_number = :customer_number,\n            customer_name = :customer_name,\n            spec_number = :spec_number,\n            d_number = :d_number,\n            item_description = :item_description,\n            test_flute = :test_flute,\n            sales_rep = :sales_rep,\n            approval_date = :approval_date,\n            digital_print = :digital_print,\n            digital_cut = :digital_cut,\n            digital_die_cut = :digital_die_cut,\n            label_die_cut = :label_die_cut,\n            label_4c_process = :label_4c_process,\n            approval_pdf = :approval_pdf\n        WHERE id = :id\n    ");
    foreach ($hydrated as $name => $value) {
        $stmt->bindValue(':' . $name, $value);
    }
    $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
    $stmt->execute();

    foreach ($hydrated as $name => $value) {
        $row[$name] = $value;
    }

    return $row;
}

function writeApprovalRevisionTemplateFdf($fields, $checkboxes, $fdfPath) {
    $fdf = "%FDF-1.2\n";
    $fdf .= "1 0 obj\n";
    $fdf .= "<<\n";
    $fdf .= "/FDF << /Fields [\n";

    foreach ($fields as $fieldName => $fieldValue) {
        $fdf .= "<< /T (" . approvalFdfEscape($fieldName) . ") /V (" . approvalFdfEscape($fieldValue) . ") >>\n";
    }

    foreach ($checkboxes as $fieldName => $checked) {
        if ($checked) {
            $fdf .= "<< /T (" . approvalFdfEscape($fieldName) . ") /V /Yes >>\n";
        }
    }

    $fdf .= "] >>\n";
    $fdf .= ">>\n";
    $fdf .= "endobj\n";
    $fdf .= "trailer\n";
    $fdf .= "<< /Root 1 0 R >>\n";
    $fdf .= "%%EOF\n";

    if (file_put_contents($fdfPath, $fdf) === false) {
        throw new Exception('Could not create temporary FDF data file for approval rebuild.');
    }
}

function fillCleanApprovalTemplateForRevisionRebuild($templatePath, $outputPdfPath, $fields, $checkboxes) {
    if (!file_exists($templatePath)) {
        throw new Exception('Clean approval template PDF was not found: ' . $templatePath);
    }

    $pdftk = findPdftkForApprovalRevision();
    if (!$pdftk) {
        throw new Exception('pdftk was not found, so the clean approval template could not be filled.');
    }

    $tempDir = __DIR__ . '/magick_tmp';
    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }
    @chmod($tempDir, 0777);

    $fdfPath = $tempDir . '/approval_rebuild_' . uniqid('', true) . '.fdf';
    writeApprovalRevisionTemplateFdf($fields, $checkboxes, $fdfPath);

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
        throw new Exception('pdftk could not rebuild the approval from the clean template: ' . implode("\n", $out));
    }
}

function rebuildApprovalRevisionPdfFromCleanTemplateWithArtwork($existingApprovalPdfPath, $artworkPath, $finalPdfPath) {
    if (!file_exists($existingApprovalPdfPath)) {
        throw new Exception('Existing approval PDF was not found before rebuilding artwork.');
    }

    if (!file_exists($artworkPath)) {
        throw new Exception('Replacement artwork file was not found before rebuilding approval.');
    }

    $templatePath = __DIR__ . '/HCC APPROVAL FORM-2026.pdf';
    $tempDir = __DIR__ . '/magick_tmp';
    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }
    @chmod($tempDir, 0777);

    $fieldData = readApprovalPdfFieldsForRevisionRebuild($existingApprovalPdfPath);
    $filledCleanPdfPath = $tempDir . '/approval_rebuild_clean_' . uniqid('', true) . '.pdf';

    fillCleanApprovalTemplateForRevisionRebuild(
        $templatePath,
        $filledCleanPdfPath,
        $fieldData['fields'],
        $fieldData['checkboxes']
    );

    try {
        placeUploadedArtworkOnApprovalPdfForRevision($filledCleanPdfPath, $artworkPath, $finalPdfPath);
    } finally {
        if (file_exists($filledCleanPdfPath)) {
            @unlink($filledCleanPdfPath);
        }
    }
}


function cropApprovalArtworkAreaToTemporaryPdfForRevision($sourcePdfPath, $croppedPdfPath) {
    if (!file_exists($sourcePdfPath)) {
        throw new Exception('Source approval PDF was not found for artwork crop.');
    }

    $python = findPythonBinaryForApprovalRevisionArt();
    if (!$python) {
        throw new Exception('python3 was not found, so the current artwork could not be preserved.');
    }

    $artBox = '26,150,740,385';

    $tempDir = __DIR__ . '/magick_tmp';
    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }
    @chmod($tempDir, 0777);

    $helperScript = $tempDir . '/crop_approval_art_box_' . uniqid('', true) . '.py';

    $script = <<<'PYHELPER'
import argparse
import sys

try:
    from pypdf import PdfReader, PdfWriter, PageObject, Transformation
    from pypdf.generic import NameObject
except Exception as exc:
    sys.stderr.write('Could not import pypdf: %s\n' % exc)
    sys.exit(2)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', required=True)
    parser.add_argument('--out', required=True)
    parser.add_argument('--box', required=True)
    args = parser.parse_args()

    try:
        x, y, w, h = [float(part.strip()) for part in args.box.split(',')]
    except Exception:
        sys.stderr.write('Invalid art box. Expected x,y,width,height.\n')
        sys.exit(3)

    reader = PdfReader(args.base)
    if len(reader.pages) < 1:
        sys.stderr.write('Source approval PDF has no pages.\n')
        sys.exit(4)

    source_page = reader.pages[0]

    # IMPORTANT:
    # Do not simply set the CropBox/MediaBox to the art area. That leaves the
    # original page contents sitting in their original coordinate system, which
    # is why the art appeared shifted/off-page after regeneration.
    # Instead, create a true 0,0 art-only page and translate the approval page
    # by -x,-y into it. The rebuilt approval can then place this cropped art PDF
    # back into the art box without any coordinate drift.
    art_page = PageObject.create_blank_page(width=w, height=h)
    art_page.merge_transformed_page(source_page, Transformation().translate(-x, -y), over=True)

    writer = PdfWriter()
    writer.add_page(art_page)

    root = reader.trailer.get('/Root', {})
    if '/AcroForm' in root:
        # Keeping this does not hurt; it also helps if a PDF viewer expects it.
        writer._root_object.update({NameObject('/AcroForm'): root['/AcroForm']})

    with open(args.out, 'wb') as handle:
        writer.write(handle)


if __name__ == '__main__':
    main()
PYHELPER;

    if (file_put_contents($helperScript, $script) === false) {
        throw new Exception('Could not create temporary artwork crop helper script.');
    }

    $cmd =
        'PATH=/opt/homebrew/bin:/usr/local/bin:/opt/local/bin:/usr/bin:/bin:/usr/sbin:/sbin ' .
        escapeshellcmd($python) . ' ' .
        escapeshellarg($helperScript) . ' ' .
        '--base ' . escapeshellarg($sourcePdfPath) . ' ' .
        '--out ' . escapeshellarg($croppedPdfPath) . ' ' .
        '--box ' . escapeshellarg($artBox) . ' ' .
        '2>&1';

    exec($cmd, $out, $ret);

    if (file_exists($helperScript)) {
        @unlink($helperScript);
    }

    if ($ret !== 0 || !file_exists($croppedPdfPath) || filesize($croppedPdfPath) <= 0) {
        throw new Exception('Could not crop current approval artwork for rebuild: ' . implode("\n", $out));
    }
}

function buildFullApprovalFieldsFromDatabaseForRevision($db, $gNumber, $revisionRows) {
    $cleanG = cleanNumber($gNumber);

    $fields = [];

    $stmt = $db->prepare("
        SELECT customer_number, customer_name, part_number
        FROM graphics
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
        LIMIT 1
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $graphic = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

    $latestRevisionRow = !empty($revisionRows) ? $revisionRows[count($revisionRows) - 1] : [];

    $fields['CUSTOMER'] = strtoupper(trim((string)($latestRevisionRow['customer_name'] ?? $graphic['customer_name'] ?? '')));
    $fields['CUST #'] = strtoupper(trim((string)($latestRevisionRow['customer_number'] ?? $graphic['customer_number'] ?? '')));
    $fields['SPEC #'] = strtoupper(trim((string)($latestRevisionRow['spec_number'] ?? '')));
    $fields['DESIGN #'] = strtoupper(trim((string)($latestRevisionRow['d_number'] ?? '')));
    $fields['ART #'] = '';
    $fields['I.D'] = strtoupper(trim((string)($latestRevisionRow['item_description'] ?? $graphic['part_number'] ?? '')));
    $fields['TEST'] = strtoupper(trim((string)($latestRevisionRow['test_flute'] ?? '')));
    $fields['Sales Rep'] = strtoupper(trim((string)($latestRevisionRow['sales_rep'] ?? '')));
    $fields['APPROVAL CREATION DATE'] = strtoupper(trim((string)($latestRevisionRow['approval_date'] ?? '')));
    $fields['DATE APPROVED'] = '';
    $fields['Signature1_es_:signer:signature'] = '';

    $revisionFields = buildRevisionOnlyFieldsForApprovalPdf($revisionRows, $cleanG);
    foreach ($revisionFields as $fieldName => $fieldValue) {
        $fields[$fieldName] = $fieldValue;
    }

    return $fields;
}

function buildApprovalCheckboxesFromRevisionRow($row) {
    return [
        'Check Box SAMPLE' => false,
        'Check Box APPROVED' => false,
        'Check Box DIGITAL PRINT' => isCheckedValue($row['digital_print'] ?? ''),
        'Check Box DIGITAL CUT' => isCheckedValue($row['digital_cut'] ?? ''),
        'Check Box DIE CUT BAYSEK' => isCheckedValue($row['digital_die_cut'] ?? ''),
        'Check Box DIE CUT LABEL' => isCheckedValue($row['label_die_cut'] ?? ''),
        'Check Box PROCESS' => isCheckedValue($row['label_4c_process'] ?? '')
    ];
}

function rebuildCurrentApprovalFromTemplateForRegeneration($db, $gNumber, $currentPdfPath, $outputPdfPath, $revisionRows) {
    $cleanG = cleanNumber($gNumber);

    if ($cleanG === '') {
        throw new Exception('Missing G# for approval rebuild.');
    }

    $templatePath = __DIR__ . '/HCC APPROVAL FORM-2026.pdf';
    if (!file_exists($templatePath)) {
        throw new Exception('Clean approval template PDF was not found: ' . $templatePath);
    }

    $tempDir = __DIR__ . '/magick_tmp';
    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }
    @chmod($tempDir, 0777);

    $croppedArtPdf = $tempDir . '/current_approval_art_crop_' . $cleanG . '_' . time() . '.pdf';
    $filledCleanPdf = $tempDir . '/current_approval_rebuild_filled_' . $cleanG . '_' . time() . '.pdf';

    cropApprovalArtworkAreaToTemporaryPdfForRevision($currentPdfPath, $croppedArtPdf);

    $fields = buildFullApprovalFieldsFromDatabaseForRevision($db, $cleanG, $revisionRows);
    $latestRevisionRow = !empty($revisionRows) ? $revisionRows[count($revisionRows) - 1] : [];
    $checkboxes = buildApprovalCheckboxesFromRevisionRow($latestRevisionRow);

    fillCleanApprovalTemplateForRevisionRebuild($templatePath, $filledCleanPdf, $fields, $checkboxes);

    try {
        placeUploadedArtworkOnApprovalPdfForRevision($filledCleanPdf, $croppedArtPdf, $outputPdfPath);
    } finally {
        if (file_exists($croppedArtPdf)) {
            @unlink($croppedArtPdf);
        }
        if (file_exists($filledCleanPdf)) {
            @unlink($filledCleanPdf);
        }
    }
}


function regenerateCurrentApprovalPdfRevisionTable($db, $gNumber) {
    $cleanG = cleanNumber($gNumber);

    if ($cleanG === '') {
        throw new Exception('Missing G# for approval regeneration.');
    }

    $stmt = $db->prepare("
        SELECT preview_image
        FROM graphics
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
        LIMIT 1
    ");
    $stmt->bindValue(':g_number', $cleanG);
    $graphic = $stmt->execute()->fetchArray(SQLITE3_ASSOC);

    $currentPdfWeb = safeWebPath($graphic['preview_image'] ?? '');

    if (!$currentPdfWeb || strpos($currentPdfWeb, 'approvals/') !== 0 || strtolower(pathinfo($currentPdfWeb, PATHINFO_EXTENSION)) !== 'pdf') {
        throw new Exception('Current approval PDF was not found for G#' . $cleanG . '.');
    }

    $currentPdfPath = __DIR__ . '/' . $currentPdfWeb;

    if (!file_exists($currentPdfPath)) {
        throw new Exception('Current approval PDF file does not exist: ' . $currentPdfWeb);
    }

    $revisionRows = getSortedApprovalRevisionRows($db, $cleanG, 4);

    if (empty($revisionRows)) {
        throw new Exception('No approval revision rows exist for G#' . $cleanG . '.');
    }

    $tempDir = __DIR__ . '/magick_tmp';
    if (!is_dir($tempDir)) {
        mkdir($tempDir, 0777, true);
    }
    @chmod($tempDir, 0777);

    $backupPath = $currentPdfPath . '.before_regen_' . time() . '.bak';
    $tempOutput = $tempDir . '/approval_regen_clean_' . $cleanG . '_' . time() . '.pdf';

    /*
        IMPORTANT:
        Do NOT run pdftk fill_form against the current approval PDF.
        The current PDF already has field appearances drawn into it. Filling it again
        creates doubled/ghosted text in the header and revision table.

        Always rebuild from the clean HCC approval template, crop/preserve only the
        artwork area from the current PDF, then write the fresh fields once.
    */
    rebuildCurrentApprovalFromTemplateForRegeneration($db, $cleanG, $currentPdfPath, $tempOutput, $revisionRows);

    if (!copy($currentPdfPath, $backupPath)) {
        @unlink($tempOutput);
        throw new Exception('Could not create a safety backup before replacing the current approval PDF.');
    }

    if (!rename($tempOutput, $currentPdfPath)) {
        @unlink($tempOutput);
        throw new Exception('Could not replace the current approval PDF after regeneration.');
    }

    // Make sure the G# preview on the Index page points to this regenerated current approval PDF.
    $updatePreview = $db->prepare("
        UPDATE graphics
        SET preview_image = :preview_image
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
    ");
    $updatePreview->bindValue(':preview_image', $currentPdfWeb);
    $updatePreview->bindValue(':g_number', $cleanG);
    $updatePreview->execute();

    return $currentPdfWeb;
}


if ($_SERVER['REQUEST_METHOD'] === 'POST') {
    $action = $_POST['action'] ?? '';

    try {
        if ($action === 'add_revision') {
            $g_number = cleanNumber($_POST['g_number'] ?? '');
            $rev = safeText($_POST['rev'] ?? '');
            $rev_date = safeText($_POST['rev_date'] ?? '');
            $description = safeText($_POST['description'] ?? '');
            $csr = safeText($_POST['csr'] ?? '');
            $dsr = safeText($_POST['dsr'] ?? '');
            $d_number = safeText($_POST['d_number'] ?? '');
            $customer_number = safeText($_POST['customer_number'] ?? '');
            $customer_name = safeText($_POST['customer_name'] ?? '');
            $spec_number = safeText($_POST['spec_number'] ?? '');
            $item_description = safeText($_POST['item_description'] ?? '');
            $test_flute = safeText($_POST['test_flute'] ?? '');
            $sales_rep = safeText($_POST['sales_rep'] ?? '');
            $approval_date = safeText($_POST['approval_date'] ?? '');
            $digital_print = checkboxTextValue('digital_print');
            $digital_cut = checkboxTextValue('digital_cut');
            $digital_die_cut = checkboxTextValue('digital_die_cut');
            $label_die_cut = checkboxTextValue('label_die_cut');
            $label_4c_process = checkboxTextValue('label_4c_process');
            $approval_pdf = safeWebPath($_POST['approval_pdf'] ?? '');
            $snapshot_image = safeWebPath($_POST['snapshot_image_existing'] ?? '');

            if ($g_number === '') {
                throw new Exception('Missing G# for the approval revision.');
            }

            $artworkWasReplaced = replaceApprovalRevisionArtworkInPdf($approval_pdf, $_FILES['approval_art_upload'] ?? null, $g_number, $rev);

            if ($artworkWasReplaced) {
                // If this approval PDF is the current Index preview for this G#, keep it pointed at the same refreshed PDF.
                $updatePreview = $db->prepare("
                    UPDATE graphics
                    SET preview_image = :preview_image
                    WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
                      AND preview_image = :preview_image
                ");
                $updatePreview->bindValue(':preview_image', $approval_pdf);
                $updatePreview->bindValue(':g_number', $g_number);
                $updatePreview->execute();
            }

            $stmt = $db->prepare("
                INSERT INTO approval_revisions
                (g_number, rev, rev_date, description, csr, dsr, d_number, customer_number, customer_name, spec_number, item_description, test_flute, sales_rep, approval_date, digital_print, digital_cut, digital_die_cut, label_die_cut, label_4c_process, approval_pdf, snapshot_image)
                VALUES
                (:g_number, :rev, :rev_date, :description, :csr, :dsr, :d_number, :customer_number, :customer_name, :spec_number, :item_description, :test_flute, :sales_rep, :approval_date, :digital_print, :digital_cut, :digital_die_cut, :label_die_cut, :label_4c_process, :approval_pdf, :snapshot_image)
            ");
            $stmt->bindValue(':g_number', $g_number);
            $stmt->bindValue(':rev', $rev);
            $stmt->bindValue(':rev_date', $rev_date);
            $stmt->bindValue(':description', $description);
            $stmt->bindValue(':csr', $csr);
            $stmt->bindValue(':dsr', $dsr);
            $stmt->bindValue(':d_number', $d_number);
            $stmt->bindValue(':customer_number', $customer_number);
            $stmt->bindValue(':customer_name', $customer_name);
            $stmt->bindValue(':spec_number', $spec_number);
            $stmt->bindValue(':item_description', $item_description);
            $stmt->bindValue(':test_flute', $test_flute);
            $stmt->bindValue(':sales_rep', $sales_rep);
            $stmt->bindValue(':approval_date', $approval_date);
            $stmt->bindValue(':digital_print', $digital_print);
            $stmt->bindValue(':digital_cut', $digital_cut);
            $stmt->bindValue(':digital_die_cut', $digital_die_cut);
            $stmt->bindValue(':label_die_cut', $label_die_cut);
            $stmt->bindValue(':label_4c_process', $label_4c_process);
            $stmt->bindValue(':approval_pdf', $approval_pdf);
            $stmt->bindValue(':snapshot_image', $snapshot_image);
            $stmt->execute();

            if ($approval_pdf !== '' && strpos($approval_pdf, 'approvals/') === 0) {
                regenerateCurrentApprovalPdfRevisionTable($db, $g_number);
            }

            $message = 'Previous approval revision added and current approval rebuilt for G# ' . htmlspecialchars($g_number) . '.';
            $messageType = 'success';
        }

        if ($action === 'update_revision') {
            $id = intval($_POST['revision_id'] ?? 0);
            $g_number = cleanNumber($_POST['g_number'] ?? '');
            $rev = safeText($_POST['rev'] ?? '');
            $rev_date = safeText($_POST['rev_date'] ?? '');
            $description = safeText($_POST['description'] ?? '');
            $csr = safeText($_POST['csr'] ?? '');
            $dsr = safeText($_POST['dsr'] ?? '');
            $d_number = safeText($_POST['d_number'] ?? '');
            $customer_number = safeText($_POST['customer_number'] ?? '');
            $customer_name = safeText($_POST['customer_name'] ?? '');
            $spec_number = safeText($_POST['spec_number'] ?? '');
            $item_description = safeText($_POST['item_description'] ?? '');
            $test_flute = safeText($_POST['test_flute'] ?? '');
            $sales_rep = safeText($_POST['sales_rep'] ?? '');
            $approval_date = safeText($_POST['approval_date'] ?? '');
            $digital_print = checkboxTextValue('digital_print');
            $digital_cut = checkboxTextValue('digital_cut');
            $digital_die_cut = checkboxTextValue('digital_die_cut');
            $label_die_cut = checkboxTextValue('label_die_cut');
            $label_4c_process = checkboxTextValue('label_4c_process');
            $approval_pdf = safeWebPath($_POST['approval_pdf'] ?? '');
            $snapshot_image = safeWebPath($_POST['snapshot_image_existing'] ?? '');

            if ($id <= 0 || $g_number === '') {
                throw new Exception('Missing required approval revision information.');
            }

            $artworkWasReplaced = replaceApprovalRevisionArtworkInPdf($approval_pdf, $_FILES['approval_art_upload'] ?? null, $g_number, $rev);

            if ($artworkWasReplaced) {
                // If this approval PDF is the current Index preview for this G#, keep it pointed at the same refreshed PDF.
                $updatePreview = $db->prepare("
                    UPDATE graphics
                    SET preview_image = :preview_image
                    WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
                      AND preview_image = :preview_image
                ");
                $updatePreview->bindValue(':preview_image', $approval_pdf);
                $updatePreview->bindValue(':g_number', $g_number);
                $updatePreview->execute();
            }

            $stmt = $db->prepare("
                UPDATE approval_revisions
                SET 
                    g_number = :g_number,
                    rev = :rev,
                    rev_date = :rev_date,
                    description = :description,
                    csr = :csr,
                    dsr = :dsr,
                    d_number = :d_number,
                    customer_number = :customer_number,
                    customer_name = :customer_name,
                    spec_number = :spec_number,
                    item_description = :item_description,
                    test_flute = :test_flute,
                    sales_rep = :sales_rep,
                    approval_date = :approval_date,
                    digital_print = :digital_print,
                    digital_cut = :digital_cut,
                    digital_die_cut = :digital_die_cut,
                    label_die_cut = :label_die_cut,
                    label_4c_process = :label_4c_process,
                    approval_pdf = :approval_pdf,
                    snapshot_image = :snapshot_image
                WHERE id = :id
            ");
            $stmt->bindValue(':g_number', $g_number);
            $stmt->bindValue(':rev', $rev);
            $stmt->bindValue(':rev_date', $rev_date);
            $stmt->bindValue(':description', $description);
            $stmt->bindValue(':csr', $csr);
            $stmt->bindValue(':dsr', $dsr);
            $stmt->bindValue(':d_number', $d_number);
            $stmt->bindValue(':customer_number', $customer_number);
            $stmt->bindValue(':customer_name', $customer_name);
            $stmt->bindValue(':spec_number', $spec_number);
            $stmt->bindValue(':item_description', $item_description);
            $stmt->bindValue(':test_flute', $test_flute);
            $stmt->bindValue(':sales_rep', $sales_rep);
            $stmt->bindValue(':approval_date', $approval_date);
            $stmt->bindValue(':digital_print', $digital_print);
            $stmt->bindValue(':digital_cut', $digital_cut);
            $stmt->bindValue(':digital_die_cut', $digital_die_cut);
            $stmt->bindValue(':label_die_cut', $label_die_cut);
            $stmt->bindValue(':label_4c_process', $label_4c_process);
            $stmt->bindValue(':approval_pdf', $approval_pdf);
            $stmt->bindValue(':snapshot_image', $snapshot_image);
            $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
            $stmt->execute();

            if ($approval_pdf !== '' && strpos($approval_pdf, 'approvals/') === 0) {
                regenerateCurrentApprovalPdfRevisionTable($db, $g_number);
            }

            $message = 'Approval revision saved and current approval rebuilt for G# ' . htmlspecialchars($g_number) . ($artworkWasReplaced ? ' with replaced approval artwork.' : '.');
            $messageType = 'success';
        }

        if ($action === 'delete_revision') {
            $id = intval($_POST['revision_id'] ?? 0);
            if ($id <= 0) {
                throw new Exception('Missing revision record ID.');
            }

            $lookup = $db->prepare("SELECT snapshot_image FROM approval_revisions WHERE id = :id LIMIT 1");
            $lookup->bindValue(':id', $id, SQLITE3_INTEGER);
            $existing = $lookup->execute()->fetchArray(SQLITE3_ASSOC);

            if ($existing && !empty($existing['snapshot_image'])) {
                $snapshotPath = safeWebPath($existing['snapshot_image']);
                if (strpos($snapshotPath, 'approval_snapshots/') === 0) {
                    $snapshotFullPath = __DIR__ . '/' . $snapshotPath;
                    if (file_exists($snapshotFullPath)) {
                        @unlink($snapshotFullPath);
                    }
                }
            }

            $stmt = $db->prepare("DELETE FROM approval_revisions WHERE id = :id");
            $stmt->bindValue(':id', $id, SQLITE3_INTEGER);
            $stmt->execute();

            $message = 'Approval revision record deleted and matching snapshot cleaned up.';
            $messageType = 'success';
        }

    } catch (Exception $e) {
        $message = htmlspecialchars($e->getMessage());
        $messageType = 'error';
    }
}

$searchQuery = trim($_GET['q_search'] ?? ($_GET['g_search'] ?? ''));
$searchG = cleanNumber($searchQuery);
$totalResult = $db->querySingle("SELECT COUNT(*) FROM approval_revisions");

$baseGroupSql = "
    SELECT 
        ar.g_number,
        COUNT(ar.id) AS revision_count,
        MAX(ar.id) AS latest_id,
        COALESCE(MAX(g.customer_number), '') AS customer_number,
        COALESCE(MAX(g.customer_name), '') AS customer_name,
        COALESCE(MAX(g.part_number), '') AS part_number,
        COALESCE(MAX(g.preview_image), '') AS current_pdf
    FROM approval_revisions ar
    LEFT JOIN graphics g
        ON REPLACE(REPLACE(g.g_number, 'G#', ''), '#', '') = REPLACE(REPLACE(ar.g_number, 'G#', ''), '#', '')
";

if ($searchQuery !== '') {
    $stmt = $db->prepare($baseGroupSql . "
        WHERE REPLACE(REPLACE(ar.g_number, 'G#', ''), '#', '') LIKE :g_number
           OR g.customer_number LIKE :search
           OR g.customer_name LIKE :search
           OR g.part_number LIKE :search
           OR ar.rev LIKE :search
           OR ar.rev_date LIKE :search
           OR ar.description LIKE :search
           OR ar.csr LIKE :search
           OR ar.dsr LIKE :search
           OR ar.d_number LIKE :search
        GROUP BY ar.g_number
        ORDER BY latest_id DESC
    ");
    $stmt->bindValue(':g_number', '%' . $searchG . '%');
    $stmt->bindValue(':search', '%' . $searchQuery . '%');
    $groupsResult = $stmt->execute();
    $resultTitle = 'Approval Revision Search Results for ' . htmlspecialchars($searchQuery);
} else {
    $groupsResult = $db->query($baseGroupSql . "
        GROUP BY ar.g_number
        ORDER BY latest_id DESC
        LIMIT 50
    ");
    $resultTitle = 'Approval Revision Groups';
}

$groups = [];
while ($group = $groupsResult->fetchArray(SQLITE3_ASSOC)) {
    $gNumber = cleanNumber($group['g_number']);

    $revStmt = $db->prepare("
        SELECT id, g_number, rev, rev_date, description, csr, dsr, d_number, customer_number, customer_name, spec_number, item_description, test_flute, sales_rep, approval_date, digital_print, digital_cut, digital_die_cut, label_die_cut, label_4c_process, approval_pdf, snapshot_image, created_at
        FROM approval_revisions
        WHERE REPLACE(REPLACE(g_number, 'G#', ''), '#', '') = :g_number
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
    $latest = null;
    while ($row = $revResult->fetchArray(SQLITE3_ASSOC)) {
        $row = hydrateCurrentRevisionFromPdfIfNeeded($db, $row);
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
<link rel="stylesheet" href="assets/css/gm2-approval-revisions.css?v=<?php echo filemtime('assets/css/gm2-approval-revisions.css'); ?>">
<title>Approval Revisions</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">


</head>

<?php $isApprovalsEmbed = isset($_GET['embed']) && $_GET['embed'] === '1'; ?>
<body class="approval-revisions-page<?php echo $isApprovalsEmbed ? ' embedded-approval-tab' : ''; ?>">
<div class="wrapper">
    <header>
        <img class="app-logo" src="SUMTER HC-LOGO-HORIZONTAL-web.png" alt="Logo">
        <h1>Approval Revisions</h1>
        <p class="subtitle">Manage approval revision history, snapshots, and older approval records.</p>

        <nav class="page-nav" aria-label="Page navigation">
            <a href="index.php">G# List</a>
            <a href="create_approval.php">Create Approval</a>
            <a class="active" href="approval_revisions.php">Approval Revisions</a>
            <a class="logout-link" href="admin.php">Admin</a>
        </nav>

        <div class="gm2-stat-strip approval-stat-strip" aria-label="Approval revision stats">
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
                <span class="gm2-stat-value"><?php echo $searchQuery !== '' ? htmlspecialchars($searchQuery) : 'All'; ?></span>
            </div>
        </div>
    </header>

    <?php if ($message): ?>
        <div class="message gm2-message <?php echo htmlspecialchars($messageType); ?>">
            <?php echo $message; ?>
        </div>
    <?php endif; ?>

    <section class="card gm-card approval-search-card">
        <div class="gm2-section-kicker">Search</div>
        <div class="approval-card-header-row">
            <div>
                <h2>Approval Revisions</h2>
                
            </div>
        </div>

        <form method="GET" class="search-row approval-search-row" id="revisionSearchForm">
            <div class="approval-search-field">
                
                <input type="text" name="q_search" id="revisionLiveSearch" value="<?php echo htmlspecialchars($searchQuery); ?>" placeholder="TYPE G#, CUSTOMER #, CUSTOMER, PART #, REV, DESCRIPTION, CSR, OR DSR" autocomplete="off">
            </div>

            <button type="submit" class="gm-btn gm-btn-primary">Search G#</button>
            <button type="button" class="gm-btn gm-btn-secondary" onclick="printDisplayedRevisionGroups()">Print Results</button>
            <a class="button-link secondary gm-btn gm-btn-secondary" href="approval_revisions.php">Show All</a>
        </form>
    </section>

    <section class="card gm-card approval-results-card">
        <div class="approval-results-header">
            <div>
                <div class="gm2-section-kicker">Revision Groups</div>
                <h2><?php echo $resultTitle; ?></h2>
            </div>
            <p class="muted approval-results-help">Expand a G# group to view, edit, delete, or add historical approval revisions.</p>
        </div>

        <?php if (empty($groups)): ?>
            <p class="muted">No approval revision records found.</p>
        <?php else: ?>
            <div class="tree">
                <?php foreach ($groups as $group):
                    $summary = $group['summary'];
                    $latest = $group['latest'];
                    $revisions = $group['revisions'];
                    $gNumber = cleanNumber($summary['g_number']);
                    $treeId = 'tree_' . preg_replace('/[^A-Za-z0-9]/', '', $gNumber);

                    $searchBlob = ($summary['g_number'] ?? '') . ' ' . ($summary['customer_number'] ?? '') . ' ' . ($summary['customer_name'] ?? '') . ' ' . ($summary['part_number'] ?? '') . ' ' . ($summary['current_pdf'] ?? '');
                    foreach ($revisions as $searchRev) {
                        $searchBlob .= ' ' . ($searchRev['rev'] ?? '') . ' ' . ($searchRev['rev_date'] ?? '') . ' ' . ($searchRev['description'] ?? '') . ' ' . ($searchRev['csr'] ?? '') . ' ' . ($searchRev['dsr'] ?? '');
                    }
                ?>
                    <div class="tree-item" id="<?php echo htmlspecialchars($treeId); ?>" data-search="<?php echo htmlspecialchars(strtoupper($searchBlob), ENT_QUOTES); ?>">
                        <div class="tree-summary" onclick="toggleTree('<?php echo htmlspecialchars($treeId); ?>')">
                            <div class="arrow">▶</div>

                            <div>
                                <span class="summary-label">G#</span>
                                <span class="summary-value highlight"><?php echo htmlspecialchars($gNumber); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">Customer #</span>
                                <span class="summary-value"><?php echo htmlspecialchars($summary['customer_number'] ?? ''); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">Customer</span>
                                <span class="summary-value"><?php echo htmlspecialchars($summary['customer_name'] ?? ''); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">Part #</span>
                                <span class="summary-value"><?php echo htmlspecialchars($summary['part_number'] ?? ''); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">Revisions</span>
                                <span class="summary-value"><?php echo intval($summary['revision_count']); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">Latest Rev</span>
                                <span class="summary-value">Rev <?php echo htmlspecialchars($latest['rev'] ?? ''); ?></span>
                            </div>

                            <div>
                                <span class="summary-label">Latest Date</span>
                                <span class="summary-value"><?php echo htmlspecialchars($latest['rev_date'] ?? ''); ?></span>
                            </div>

                            <div>
                                <button type="button" class="gm-btn gm-btn-secondary gm-btn-compact" onclick="event.stopPropagation(); toggleTree('<?php echo htmlspecialchars($treeId); ?>')">Open</button>
                            </div>
                        </div>

                        <div class="tree-details">
                            <div class="section-actions">
                                <?php if (!empty($summary['current_pdf'])): ?>
                                    <button type="button" class="gm-btn gm-btn-secondary gm-btn-compact" onclick="openPdfView('<?php echo htmlspecialchars($summary['current_pdf'], ENT_QUOTES); ?>', 'Current Approval PDF — G#<?php echo htmlspecialchars(cleanNumber($summary['g_number']), ENT_QUOTES); ?>')">View Current PDF</button>
                                <?php endif; ?>
                                <button type="button" class="gm-btn gm-btn-primary gm-btn-compact" onclick="toggleAddPrevious('add_prev_<?php echo htmlspecialchars($treeId); ?>')">Add Revision</button>
                            </div>

                            <div class="add-previous-panel" id="add_prev_<?php echo htmlspecialchars($treeId); ?>">
                                <form method="POST" enctype="multipart/form-data">
                                    <input type="hidden" name="action" value="add_revision">

                                    <div class="edit-grid">
                                        <div>
                                            <label>G#</label>
                                            <input type="text" name="g_number" value="<?php echo htmlspecialchars($gNumber); ?>" required>
                                        </div>

                                        <div>
                                            <label>D#</label>
                                            <input type="text" name="d_number" placeholder="Optional D#">
                                        </div>

                                        <div>
                                            <label>Customer</label>
                                            <input type="text" name="customer_name" value="<?php echo htmlspecialchars($summary['customer_name'] ?? ''); ?>">
                                        </div>

                                        <div>
                                            <label>Customer #</label>
                                            <input type="text" name="customer_number" value="<?php echo htmlspecialchars($summary['customer_number'] ?? ''); ?>">
                                        </div>

                                        <div>
                                            <label>Spec #</label>
                                            <input type="text" name="spec_number" placeholder="Optional">
                                        </div>

                                        <div>
                                            <label>Item Description</label>
                                            <input type="text" name="item_description" value="<?php echo htmlspecialchars($summary['part_number'] ?? ''); ?>">
                                        </div>

                                        <div>
                                            <label>Test & Flute</label>
                                            <input type="text" name="test_flute" placeholder="Example: 200 ECT C KRAFT">
                                        </div>

                                        <div>
                                            <label>Sales Rep</label>
                                            <input type="text" name="sales_rep" placeholder="Sales initials">
                                        </div>

                                        <div>
                                            <label>Approval Date</label>
                                            <input type="text" name="approval_date" placeholder="Example: 6/16/26">
                                        </div>

                                        <div class="wide approval-options-panel">
                                            <label>Production Options</label>
                                            <div class="approval-options-grid">
                                                <label class="approval-check-row"><input type="checkbox" name="digital_print"> Digital Print</label>
                                                <label class="approval-check-row"><input type="checkbox" name="digital_cut"> Digital Cut</label>
                                                <label class="approval-check-row"><input type="checkbox" name="digital_die_cut"> Die Cut (Baysek)</label>
                                                <label class="approval-check-row"><input type="checkbox" name="label_die_cut"> Label Die Cut</label>
                                                <label class="approval-check-row"><input type="checkbox" name="label_4c_process"> 4-C Process</label>
                                            </div>
                                        </div>

                                        <div>
                                            <label>Rev #</label>
                                            <input type="text" name="rev" placeholder="Example: 0, 1, 2, A">
                                        </div>

                                        <div>
                                            <label>Date</label>
                                            <input type="text" name="rev_date" placeholder="Example: 5/19/26">
                                        </div>

                                        <div>
                                            <label>CSR</label>
                                            <input type="text" name="csr" placeholder="CSR initials">
                                        </div>

                                        <div>
                                            <label>DSR</label>
                                            <input type="text" name="dsr" placeholder="Designer initials">
                                        </div>

                                        <div>
                                            <label>Approval PDF Path</label>
                                            <input type="text" name="approval_pdf" placeholder="Optional: approvals/12874_APPROVAL.pdf">
                                        </div>

                                        <div class="wide">
                                            <label>Description</label>
                                            <textarea name="description" placeholder="Example: OLD APPROVAL FROM PREVIOUS SYSTEM"></textarea>
                                        </div>
                                    </div>

                                    <div class="edit-actions">
                                        <button type="submit" class="gm-btn gm-btn-primary">Add Previous Approval Revision</button>
                                        <button type="button" class="gm-btn gm-btn-secondary" onclick="toggleAddPrevious('add_prev_<?php echo htmlspecialchars($treeId); ?>')">Cancel</button>
                                    </div>
                                </form>

                                <p class="muted" style="margin-bottom:0;">This adds a historical approval revision record. Use the importer in System Tools when you need to bring in older approval snapshots.</p>
                            </div>

                            <div class="revision-list">
                                <?php foreach ($revisions as $row):
                                    $editId = 'edit_' . intval($row['id']);
                                    $snapshot = safeWebPath($row['snapshot_image'] ?? '');
                                    $pdf = safeWebPath($row['approval_pdf'] ?? '');
                                ?>
                                    <div>
                                        <div class="revision-line">
                                            <span><strong>Rev:</strong> <?php echo htmlspecialchars($row['rev']); ?></span>
                                            <span><strong>Date:</strong> <?php echo htmlspecialchars($row['rev_date']); ?></span>
                                            <span class="revision-desc"><strong>Desc:</strong> <?php echo htmlspecialchars($row['description']); ?></span>
                                            <span><strong>CSR:</strong> <?php echo htmlspecialchars($row['csr']); ?></span>
                                            <span><strong>DSR:</strong> <?php echo htmlspecialchars($row['dsr']); ?></span>

                                            <div class="revision-actions">
                                                <?php if ($snapshot): ?>
                                                    <button type="button" class="gm-btn gm-btn-secondary gm-btn-compact" onclick="openSnapshotView(
                                                        '<?php echo htmlspecialchars($snapshot, ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($gNumber, ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['rev'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['rev_date'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['description'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['csr'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['dsr'], ENT_QUOTES); ?>',
                                                        '<?php echo htmlspecialchars($row['created_at'], ENT_QUOTES); ?>'
                                                    )">View Snapshot</button>
                                                <?php endif; ?>

                                                <?php if ($pdf): ?>
                                                    <button type="button" class="gm-btn gm-btn-secondary gm-btn-compact" onclick="openPdfView('<?php echo htmlspecialchars($pdf, ENT_QUOTES); ?>', 'Approval PDF — G#<?php echo htmlspecialchars($row['g_number'], ENT_QUOTES); ?> Rev <?php echo htmlspecialchars($row['rev'], ENT_QUOTES); ?>')">View PDF</button>
                                                <?php endif; ?>

                                                <button type="button" class="gm-btn gm-btn-primary gm-btn-compact" onclick="toggleEdit('<?php echo htmlspecialchars($editId); ?>')">Edit</button>

                                                <form method="POST" onsubmit="return confirm('Delete this single approval revision record?');">
                                                    <input type="hidden" name="action" value="delete_revision">
                                                    <input type="hidden" name="revision_id" value="<?php echo intval($row['id']); ?>">
                                                    <button type="submit" class="gm-btn gm-btn-danger gm-btn-compact">Delete</button>
                                                </form>
                                            </div>
                                        </div>

                                        <div class="edit-panel" id="<?php echo htmlspecialchars($editId); ?>">
                                            <form method="POST" enctype="multipart/form-data">
                                                <input type="hidden" name="action" value="update_revision">
                                                <input type="hidden" name="revision_id" value="<?php echo intval($row['id']); ?>">
                                                <input type="hidden" name="snapshot_image_existing" value="<?php echo htmlspecialchars($snapshot); ?>">

                                                <div class="edit-grid">
                                                    <div>
                                                        <label>G#</label>
                                                        <input type="text" name="g_number" value="<?php echo htmlspecialchars($row['g_number']); ?>" required>
                                                    </div>

                                                    <div>
                                                        <label>D#</label>
                                                        <input type="text" name="d_number" value="<?php echo htmlspecialchars($row['d_number'] ?? ''); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Customer</label>
                                                        <input type="text" name="customer_name" value="<?php echo htmlspecialchars($row['customer_name'] ?? ($summary['customer_name'] ?? '')); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Customer #</label>
                                                        <input type="text" name="customer_number" value="<?php echo htmlspecialchars($row['customer_number'] ?? ($summary['customer_number'] ?? '')); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Spec #</label>
                                                        <input type="text" name="spec_number" value="<?php echo htmlspecialchars($row['spec_number'] ?? ''); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Item Description</label>
                                                        <input type="text" name="item_description" value="<?php echo htmlspecialchars($row['item_description'] ?? ($summary['part_number'] ?? '')); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Test & Flute</label>
                                                        <input type="text" name="test_flute" value="<?php echo htmlspecialchars($row['test_flute'] ?? ''); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Sales Rep</label>
                                                        <input type="text" name="sales_rep" value="<?php echo htmlspecialchars($row['sales_rep'] ?? ''); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Approval Date</label>
                                                        <input type="text" name="approval_date" value="<?php echo htmlspecialchars($row['approval_date'] ?? ''); ?>">
                                                    </div>

                                                    <div class="wide approval-options-panel">
                                                        <label>Production Options</label>
                                                        <div class="approval-options-grid">
                                                            <label class="approval-check-row"><input type="checkbox" name="digital_print" <?php echo isCheckedValue($row['digital_print'] ?? '') ? 'checked' : ''; ?>> Digital Print</label>
                                                            <label class="approval-check-row"><input type="checkbox" name="digital_cut" <?php echo isCheckedValue($row['digital_cut'] ?? '') ? 'checked' : ''; ?>> Digital Cut</label>
                                                            <label class="approval-check-row"><input type="checkbox" name="digital_die_cut" <?php echo isCheckedValue($row['digital_die_cut'] ?? '') ? 'checked' : ''; ?>> Die Cut (Baysek)</label>
                                                            <label class="approval-check-row"><input type="checkbox" name="label_die_cut" <?php echo isCheckedValue($row['label_die_cut'] ?? '') ? 'checked' : ''; ?>> Label Die Cut</label>
                                                            <label class="approval-check-row"><input type="checkbox" name="label_4c_process" <?php echo isCheckedValue($row['label_4c_process'] ?? '') ? 'checked' : ''; ?>> 4-C Process</label>
                                                        </div>
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
                                                        <label>DSR</label>
                                                        <input type="text" name="dsr" value="<?php echo htmlspecialchars($row['dsr']); ?>">
                                                    </div>

                                                    <div>
                                                        <label>Approval PDF Path</label>
                                                        <input type="text" name="approval_pdf" value="<?php echo htmlspecialchars($pdf); ?>">
                                                    </div>

                                                    <div class="wide">
                                                        <label>Replace Background Artwork PDF/Image</label>
                                                        <input type="file" name="approval_art_upload" accept="application/pdf,.pdf,image/jpeg,image/png,.jpg,.jpeg,.png">
                                                        <p class="muted mt-6">Updates only the artwork area inside the attached approval PDF. Form fields and revision data stay intact.</p>
                                                    </div>

                                                    <div class="wide">
                                                        <label>Description</label>
                                                        <textarea name="description"><?php echo htmlspecialchars($row['description']); ?></textarea>
                                                    </div>
                                                </div>

                                                <div class="edit-actions">
                                                    <button type="submit" class="gm-btn gm-btn-primary">Save Revision &amp; Rebuild Approval</button>
                                                    <button type="button" class="gm-btn gm-btn-secondary" onclick="toggleEdit('<?php echo htmlspecialchars($editId); ?>')">Cancel</button>
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
            <p id="revisionNoResults" class="muted" style="display:none;">No matching approval revision groups found.</p>
        <?php endif; ?>
    </section>
</div>

<div id="snapshotViewModal" class="view-modal" onclick="closeSnapshotView()">
    <div class="view-box" onclick="event.stopPropagation()">
        <div class="view-top">
            <div>
                <h2>Approval Snapshot</h2>
                <p class="muted gm-no-margin-bottom" id="viewSubtitle"></p>
            </div>
            <div class="view-actions">
                <button type="button" class="gm-btn gm-btn-primary" onclick="printSnapshotModal()">Print Snapshot</button>
                <a id="downloadSnapshotLink" class="button-link secondary gm-btn gm-btn-secondary" href="#" download>Download</a>
                <button type="button" class="close-modal gm-btn gm-btn-danger" onclick="closeSnapshotView()">×</button>
            </div>
        </div>

        <div class="view-image-wrap">
            <img id="viewImage" class="view-image" src="" alt="Approval Revision Snapshot">
        </div>

        <div class="view-grid">
            <div class="view-field">
                <span class="view-label">G#</span>
                <span class="view-value" id="viewG"></span>
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
                <span class="view-label">CSR / DSR</span>
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
    </div>
</div>

<div id="pdfViewModal" class="view-modal<?php echo $regeneratedApprovalWeb ? ' active' : ''; ?>" onclick="closePdfView()">
    <div class="view-box" style="width:min(1280px,98vw); height:96vh; display:flex; flex-direction:column;" onclick="event.stopPropagation()">
        <div class="view-top">
            <div>
                <h2 id="pdfViewTitle"><?php echo $regeneratedApprovalWeb ? 'Updated Current Approval PDF — G#' . htmlspecialchars($regeneratedApprovalG) : 'Approval PDF'; ?></h2>
                <p class="muted gm-no-margin-bottom" id="pdfViewSubtitle"><?php echo $regeneratedApprovalWeb ? 'The current approval PDF was rebuilt and reattached to the Index preview.' : ''; ?></p>
            </div>
            <div class="view-actions">
                <button type="button" class="gm-btn gm-btn-primary" onclick="printPdfModal()">Print PDF</button>
                <a id="downloadPdfLink" class="button-link secondary gm-btn gm-btn-secondary" href="<?php echo $regeneratedApprovalWeb ? 'approval_revisions.php?gm2_download=1&file=' . urlencode($regeneratedApprovalWeb) . '&name=' . urlencode(basename($regeneratedApprovalWeb)) : '#'; ?>">Download</a>
                <button type="button" class="close-modal gm-btn gm-btn-danger" onclick="closePdfView()">×</button>
            </div>
        </div>

        <div class="view-image-wrap" style="flex:1; min-height:0;">
            <img
                id="pdfViewImage"
                class="view-image"
                src="<?php echo $regeneratedApprovalWeb ? 'approval_revisions.php?gm2_pdf_preview=1&file=' . urlencode($regeneratedApprovalWeb) . '&v=' . time() : ''; ?>"
                alt="Approval PDF Preview"
                style="width:100%; height:100%; object-fit:contain; background:white; border-radius:5px;"
            >
        </div>
        <iframe
            id="pdfViewFrame"
            src="<?php echo $regeneratedApprovalWeb ? htmlspecialchars($regeneratedApprovalWeb) . '?v=' . time() . '#zoom=page-fit' : ''; ?>"
            title="Approval PDF"
            style="display:none;">
        </iframe>
    </div>
</div>

<script>
function toggleTree(id) {
    const item = document.getElementById(id);
    if (item) item.classList.toggle('open');
}

function toggleEdit(id) {
    const panel = document.getElementById(id);
    if (panel) panel.classList.toggle('active');
}

function toggleAddPrevious(id) {
    const panel = document.getElementById(id);
    if (panel) panel.classList.toggle('active');
}

function buildApprovalPdfDownloadUrl(pdfPath) {
    const cleanPath = String(pdfPath || '').split('?')[0].split('#')[0];
    const fileName = cleanPath.split('/').pop() || 'approval.pdf';
    return 'approval_revisions.php?gm2_download=1&file=' + encodeURIComponent(cleanPath) + '&name=' + encodeURIComponent(fileName);
}

function openPdfView(pdfPath, title) {
    const modal = document.getElementById('pdfViewModal');
    const frame = document.getElementById('pdfViewFrame');
    const image = document.getElementById('pdfViewImage');
    const titleEl = document.getElementById('pdfViewTitle');
    const subtitle = document.getElementById('pdfViewSubtitle');
    const download = document.getElementById('downloadPdfLink');

    if (!modal || !pdfPath) return;

    const cacheBustedPath = pdfPath + '?v=' + Date.now() + '#zoom=page-fit';
    const previewPath = 'approval_revisions.php?gm2_pdf_preview=1&file=' + encodeURIComponent(pdfPath) + '&v=' + Date.now();
    if (image) image.src = previewPath;
    if (frame) frame.src = cacheBustedPath;
    if (titleEl) titleEl.textContent = title || 'Approval PDF';
    if (subtitle) subtitle.textContent = 'Opened inside Graphics Manager.';
    if (download) download.href = buildApprovalPdfDownloadUrl(pdfPath);
    modal.classList.add('active');
}

function closePdfView() {
    const modal = document.getElementById('pdfViewModal');
    const frame = document.getElementById('pdfViewFrame');
    const image = document.getElementById('pdfViewImage');
    if (modal) modal.classList.remove('active');
    if (frame) frame.src = '';
    if (image) image.src = '';
}

function printPdfModal() {
    const frame = document.getElementById('pdfViewFrame');
    if (frame && frame.contentWindow) {
        frame.contentWindow.focus();
        frame.contentWindow.print();
    }
}

function openSnapshotView(imagePath, g, rev, revDate, description, csr, dsr, created) {
    document.getElementById('viewG').textContent = g || '';
    document.getElementById('viewRev').textContent = rev || '';
    document.getElementById('viewDate').textContent = revDate || '';
    document.getElementById('viewDescription').textContent = description || '';
    document.getElementById('viewPeople').textContent = 'CSR: ' + (csr || '') + ' / DSR: ' + (dsr || '');
    document.getElementById('viewCreated').textContent = created || '';
    document.getElementById('viewSubtitle').textContent = 'G# ' + (g || '') + ' — Rev ' + (rev || '');

    const image = document.getElementById('viewImage');
    const download = document.getElementById('downloadSnapshotLink');
    const cacheBustedPath = imagePath + '?v=' + Date.now();

    if (image) image.src = cacheBustedPath;
    if (download) download.href = imagePath;

    document.getElementById('snapshotViewModal').classList.add('active');
}

function closeSnapshotView() {
    document.getElementById('snapshotViewModal').classList.remove('active');
    const image = document.getElementById('viewImage');
    if (image) image.src = '';
}

function printSnapshotModal() {
    const image = document.getElementById('viewImage');
    if (!image || !image.src) return;

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Approval Revision Snapshot</title>
            <style>
                body { margin: 0; padding: 18px; font-family: Arial, Helvetica, sans-serif; }
                img { display: block; width: 100%; height: auto; max-height: 95vh; object-fit: contain; }
            </style>
        </head>
        <body>
            <img src="${escapeHtmlAttr(image.src)}" alt="Approval Revision Snapshot">
        </body>
        </html>
    `);
    printWindow.document.close();
    printWindow.focus();
    setTimeout(() => printWindow.print(), 250);
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
        if (isMatch) shown++;
    });

    const noResults = document.getElementById('revisionNoResults');
    if (noResults) noResults.style.display = shown === 0 ? 'block' : 'none';
}

function printDisplayedRevisionGroups() {
    const visibleItems = Array.from(document.querySelectorAll('.tree-item')).filter(item => item.style.display !== 'none');
    const searchText = revisionLiveSearch ? revisionLiveSearch.value.trim() : '';
    let rows = '';

    visibleItems.forEach(item => {
        const summaryValues = item.querySelectorAll('.tree-summary .summary-value');
        const g = summaryValues[0] ? summaryValues[0].innerText.trim() : '';
        const customerNumber = summaryValues[1] ? summaryValues[1].innerText.trim() : '';
        const customer = summaryValues[2] ? summaryValues[2].innerText.trim() : '';
        const partNumber = summaryValues[3] ? summaryValues[3].innerText.trim() : '';
        const count = summaryValues[4] ? summaryValues[4].innerText.trim() : '';
        const latestRev = summaryValues[5] ? summaryValues[5].innerText.trim() : '';
        const latestDate = summaryValues[6] ? summaryValues[6].innerText.trim() : '';

        rows += `
            <tr>
                <td>${escapePrintHtml(g)}</td>
                <td>${escapePrintHtml(customerNumber)}</td>
                <td>${escapePrintHtml(customer)}</td>
                <td>${escapePrintHtml(partNumber)}</td>
                <td>${escapePrintHtml(count)}</td>
                <td>${escapePrintHtml(latestRev)}</td>
                <td>${escapePrintHtml(latestDate)}</td>
            </tr>
        `;
    });

    if (!rows) rows = '<tr><td colspan="7">No displayed results to print.</td></tr>';

    const printWindow = window.open('', '_blank');
    printWindow.document.write(`
        <!DOCTYPE html>
        <html>
        <head>
            <title>Approval Revision Report</title>
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
            <h1>Approval Revision Report</h1>
            <p>${searchText ? 'Displayed search results for: ' + escapePrintHtml(searchText) : 'All displayed approval revision groups'}</p>
            <table>
                <thead>
                    <tr>
                        <th>G#</th>
                        <th>Customer #</th>
                        <th>Customer</th>
                        <th>Part #</th>
                        <th>Revision Count</th>
                        <th>Latest Revision</th>
                        <th>Latest Date</th>
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

function escapeHtmlAttr(value) {
    return String(value ?? '').replace(/"/g, '&quot;');
}

document.addEventListener('input', function(event) {
    if ((event.target.tagName === 'INPUT' || event.target.tagName === 'TEXTAREA') && event.target.type !== 'file') {
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
