<?php

$db = new SQLite3('graphics.db');

header('Content-Type: text/csv');

$date = date('m-d-Y_h-i-A');

header("Content-Disposition: attachment; filename=\"graphics_report_$date.csv\"");

$output = fopen('php://output', 'w');

fputcsv($output, [
    'G#',
    'Customer #',
    'Customer Name',
    'Part #'
]);

$results = $db->query("
    SELECT *
    FROM graphics
    ORDER BY id DESC
");

while ($row = $results->fetchArray(SQLITE3_ASSOC)) {

    fputcsv($output, [
        $row['g_number'],
        $row['customer_number'],
        $row['customer_name'],
        $row['part_number']
    ]);
}

fclose($output);
exit;
?>