<?php

$db = new SQLite3('graphics.db');

$results = $db->query("
    SELECT *
    FROM graphics
    ORDER BY id DESC
");

?>

<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="UTF-8">
<title>Graphics Report</title>

<style>

body {
    font-family: Arial, Helvetica, sans-serif;
    margin: 40px;
    color: #000;
}

h1 {
    margin-bottom: 8px;
}

.subtitle {
    margin-bottom: 25px;
    color: #555;
}

table {
    width: 100%;
    border-collapse: collapse;
}

th {
    background: #16B8A6;
    color: white;
    text-align: left;
    padding: 10px;
    font-size: 12px;
}

td {
    padding: 8px 10px;
    border-bottom: 1px solid #ccc;
    font-size: 11px;
}

.gnum {
    font-weight: bold;
}

@media print {

    body {
        margin: 0;
    }

    button {
        display: none;
    }

}

.print-bar {
    margin-bottom: 20px;
}

.print-btn {
    padding: 10px 18px;
    border: none;
    background: #16B8A6;
    color: white;
    font-weight: bold;
    cursor: pointer;
}

</style>
</head>

<body>

<div class="print-bar">
    <button class="print-btn" onclick="window.print()">
        Print
    </button>
</div>

<h1>Graphics Management Report</h1>

<div class="subtitle">
    Generated:
    <?php echo date('m/d/Y h:i A'); ?>
</div>

<table>

<tr>
    <th>G#</th>
    <th>Customer #</th>
    <th>Customer Name</th>
    <th>Part #</th>
</tr>

<?php while ($row = $results->fetchArray(SQLITE3_ASSOC)): ?>

<tr>
    <td class="gnum">
        <?php echo htmlspecialchars($row['g_number']); ?>
    </td>

    <td>
        <?php echo htmlspecialchars($row['customer_number']); ?>
    </td>

    <td>
        <?php echo htmlspecialchars($row['customer_name']); ?>
    </td>

    <td>
        <?php echo htmlspecialchars($row['part_number']); ?>
    </td>
</tr>

<?php endwhile; ?>

</table>

</body>
</html>