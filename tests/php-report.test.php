<?php
/*
 * SPDX-FileCopyrightText: Private Entrepreneur Vitalii Boiko
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
require '/opt/report/vendor/autoload.php';
require getenv('MAGELENS_REPORT_DATA') ?: __DIR__ . '/../docker/php/report-data.php';

use SebastianBergmann\CodeCoverage\Report\Clover;
use SebastianBergmann\CodeCoverage\Report\Html\Facade;

function check(bool $condition, string $message): void
{
    if (!$condition) throw new RuntimeException($message);
}
function lineOf(string $source, string $needle): int
{
    foreach (explode("\n", $source) as $index => $line) if (str_contains($line, $needle)) return $index + 1;
    throw new RuntimeException("Missing fixture: $needle");
}
$root = sys_get_temp_dir() . '/magelens-php-report-' . bin2hex(random_bytes(6));
mkdir($root . '/original/app/code/Fixture', 0777, true);
mkdir($root . '/runtime/app/code/Fixture', 0777, true);
try {
    $source = <<<'PHTML'
<?php
declare(strict_types=1);
$label = 'visible';
if (false) {
    $label = 'never-php';
}
?>
<section>Static markup</section>
<script>
function unusedBrowserFunction() {
    return 'never-javascript';
}
</script>
<p><?= $label ?></p>
<?php
// This comment is not executable.
$multiline = strtoupper(
    $label
);
echo $multiline;
PHTML;
    $sources = [
        'app/code/Fixture/mixed.phtml' => $source,
        'app/code/Fixture/unused.phtml' => "<?php\n\$unused = 'unvisited';\n?>\n<script>window.unused = true;</script>\n",
        'app/code/Fixture/static.phtml' => "<div>Only markup</div>\n",
        'app/code/Fixture/only.php' => "<?php\n\$plain = 'php';\necho \$plain;\n",
    ];
    $scope = $hashes = [];
    foreach ($sources as $relative => $text) {
        file_put_contents($root . '/original/' . $relative, $text);
        file_put_contents($root . '/runtime/' . $relative,
            str_replace('<script>', '<script>window.__mtcTemplateHit = function() {};', $text));
        $scope[$root . '/runtime/' . $relative] = true;
        $hashes['src/' . $relative] = hash('sha256', $text);
    }
    $mixed = $root . '/runtime/app/code/Fixture/mixed.phtml';
    pcov\start();
    ob_start();
    include $mixed;
    include $root . '/runtime/app/code/Fixture/static.phtml';
    include $root . '/runtime/app/code/Fixture/only.php';
    ob_end_clean();
    pcov\stop();
    $raw = pcov\collect(pcov\inclusive, array_keys($scope));
    check(isset($raw[$mixed]), 'PCOV did not collect the fixture');
    $coverage = applicationPhpReportData($scope, $raw, $hashes, 'Playwright HTTP fixture', $root . '/original', $root . '/runtime');
    $data = $coverage->getData()->lineCoverage();
    $lines = $data[$root . '/original/app/code/Fixture/mixed.phtml'];
    check(!empty($lines[lineOf($source, "\$label = 'visible'")]), 'Executed PHP is missing');
    check($lines[lineOf($source, "\$label = 'never-php'")] === [], 'Unexecuted PHP was covered');
    check(!empty($lines[lineOf($source, '<p><?=')]), 'PHP embedded in markup is missing');
    check(!empty($lines[lineOf($source, '$multiline =')]), 'Multiline PHP is missing');
    foreach (['Static markup', '<script>', 'unusedBrowserFunction', 'never-javascript', '</script>', '// This comment'] as $needle) {
        check(!array_key_exists(lineOf($source, $needle), $lines), "Non-PHP line counted: $needle");
    }
    check($data[$root . '/original/app/code/Fixture/static.phtml'] === [], 'Markup-only file has PHP lines');
    check($data[$root . '/original/app/code/Fixture/unused.phtml'][2] === [], 'Unvisited PHP is missing from denominator');
    check(!empty($data[$root . '/original/app/code/Fixture/only.php'][2]), 'PHP-only file is missing');
    (new Facade)->process($coverage, $root . '/report');
    $xml = (new Clover)->process($coverage);
    check(str_contains($xml, '/original/app/code/Fixture/unused.phtml'), 'Unvisited file absent from Clover');
    $html = file_get_contents($root . '/report/mixed.phtml.html');
    check(!str_contains($html, '__mtcTemplateHit'), 'HTML shows injected instrumentation');
    check(str_contains($html, 'Playwright HTTP fixture'), 'Runner label is missing');
    check(str_contains($html, 'never-javascript'), 'Original source is not displayed');
    $node = new SimpleXMLElement($xml);
    $reported = (int) $node->project->metrics['statements'];
    check($reported === array_sum(array_map('count', $data)), 'Clover denominator differs from filtered data');
    $tokens = applicationPhpTokenLines("<?php\r\n/* comment */\r\necho 'yes';\r\n?>\r\n<script>never()</script>");
    check(array_keys($tokens) === [3], 'CRLF/comment/tag handling is incorrect');
    file_put_contents($root . '/original/app/code/Fixture/mixed.phtml', $source . "\n<?php echo 'changed'; ?>");
    try {
        applicationPhpReportData($scope, $raw, $hashes, 'fixture', $root . '/original', $root . '/runtime');
        throw new RuntimeException('Changed original source was accepted');
    } catch (RuntimeException $error) {
        check(str_contains($error->getMessage(), 'missing or changed'), $error->getMessage());
    }
    echo "PASS: real PCOV hits, PHP-only lines, original source HTML, mixed lines, unvisited files and changed-source rejection.\n";
} finally {
    $files = new RecursiveIteratorIterator(new RecursiveDirectoryIterator($root, FilesystemIterator::SKIP_DOTS), RecursiveIteratorIterator::CHILD_FIRST);
    foreach ($files as $file) $file->isDir() ? rmdir($file->getPathname()) : unlink($file->getPathname());
    rmdir($root);
}
