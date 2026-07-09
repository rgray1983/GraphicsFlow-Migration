<?php
$activeTab = $_GET['tab'] ?? 'create';
if (!in_array($activeTab, ['create', 'revisions'], true)) {
    $activeTab = 'create';
}

$createActive = $activeTab === 'create';
$revisionActive = $activeTab === 'revisions';
$frameSrc = $createActive ? 'create_approval.php?embed=1' : 'approval_revisions.php?embed=1';
?>
<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;600;800&display=swap" rel="stylesheet">
<link rel="stylesheet" href="assets/css/gm2-base.css?v=<?php echo filemtime('assets/css/gm2-base.css'); ?>">
<link rel="stylesheet" href="assets/css/gm2-approvals.css?v=<?php echo filemtime('assets/css/gm2-approvals.css'); ?>">
<title>Approvals</title>
<meta name="viewport" content="width=device-width, initial-scale=1.0">
</head>

<body class="approvals-page">
<div class="wrapper">
    <header>
        <img class="app-logo" src="SUMTER HC-LOGO-HORIZONTAL-web.png" alt="Logo">
        <h1>Approvals</h1>
        <p class="subtitle">Create approval PDFs and manage approval revision history from one workspace.</p>

        <nav class="page-nav" aria-label="Page navigation">
            <a href="index.php">G# List</a>
            <a class="active" href="approvals.php?tab=create">Approvals</a>
            <a href="printcard_revisions.php">Print Card Revisions</a>
            <a class="logout-link" href="admin.php">Admin</a>
        </nav>

        <nav class="approvals-tab-nav" aria-label="Approval sections">
            <a class="approvals-tab-link <?php echo $createActive ? 'active' : ''; ?>" href="approvals.php?tab=create">
                Create Approval
            </a>
            <a class="approvals-tab-link <?php echo $revisionActive ? 'active' : ''; ?>" href="approvals.php?tab=revisions">
                Approval Revisions
            </a>
        </nav>
    </header>

    <p class="approvals-hub-note">Use the tabs above to switch between building new approval PDFs and maintaining approval revision history.</p>

    <section class="card gm-card approvals-hub-card">
        <iframe
            id="approvalsFrame"
            class="approvals-frame"
            src="<?php echo htmlspecialchars($frameSrc); ?>"
            title="<?php echo $createActive ? 'Create Approval' : 'Approval Revisions'; ?>"
            loading="eager"></iframe>
    </section>
</div>

<script>
(function() {
    const frame = document.getElementById('approvalsFrame');
    if (!frame) return;

    let resizeQueued = false;
    let resizeObserver = null;
    let mutationObserver = null;

    function getEmbeddedContentHeight(doc) {
        const wrapper = doc.querySelector('.wrapper');

        if (wrapper) {
            const rect = wrapper.getBoundingClientRect();
            const styles = doc.defaultView.getComputedStyle(wrapper);
            const marginTop = parseFloat(styles.marginTop) || 0;
            const marginBottom = parseFloat(styles.marginBottom) || 0;
            return Math.ceil(rect.height + marginTop + marginBottom);
        }

        const body = doc.body;
        const html = doc.documentElement;

        return Math.ceil(Math.max(
            body ? body.scrollHeight : 0,
            html ? html.scrollHeight : 0
        ));
    }

    function resizeFrame() {
        resizeQueued = false;

        try {
            const doc = frame.contentDocument || frame.contentWindow.document;
            if (!doc || !doc.body || !doc.documentElement) return;

            const contentHeight = getEmbeddedContentHeight(doc);
            const nextHeight = Math.max(contentHeight + 8, 700);
            const currentHeight = parseInt(frame.style.height || '0', 10) || 0;

            if (Math.abs(currentHeight - nextHeight) > 4) {
                frame.style.height = nextHeight + 'px';
            }
        } catch (error) {
            frame.style.height = '1200px';
        }
    }

    function queueResize() {
        if (resizeQueued) return;
        resizeQueued = true;
        window.requestAnimationFrame(resizeFrame);
    }

    function attachFrameObservers() {
        try {
            if (resizeObserver) {
                resizeObserver.disconnect();
            }

            if (mutationObserver) {
                mutationObserver.disconnect();
            }

            const doc = frame.contentDocument || frame.contentWindow.document;
            if (!doc || !doc.body) return;

            const target = doc.querySelector('.wrapper') || doc.body;

            if ('ResizeObserver' in window) {
                resizeObserver = new ResizeObserver(queueResize);
                resizeObserver.observe(target);
            }

            mutationObserver = new MutationObserver(queueResize);
            mutationObserver.observe(target, {
                attributes: true,
                childList: true,
                subtree: true,
                characterData: true
            });

            queueResize();
            setTimeout(queueResize, 250);
            setTimeout(queueResize, 800);
        } catch (error) {
            queueResize();
        }
    }

    frame.addEventListener('load', attachFrameObservers);
    window.addEventListener('resize', queueResize);
})();
</script>
</body>
</html>
