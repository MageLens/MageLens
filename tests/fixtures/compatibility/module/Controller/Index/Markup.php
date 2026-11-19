<?php
/*
 * Copyright (c)  MageLens
 * SPDX-License-Identifier: Elastic-2.0
 * License: see LICENSE in the repository root.
 */

declare(strict_types=1);
namespace MageLens\Compatibility\Controller\Index;
// Serves complete documents without theme markup, so HTML validation findings are deterministic.
class Markup implements \Magento\Framework\App\Action\HttpGetActionInterface
{
    public function __construct(private \Magento\Framework\App\RequestInterface $request, private \Magento\Framework\Controller\Result\RawFactory $raw) {}
    public function execute()
    {
        $result = $this->raw->create()->setHeader('Content-Type', 'text/html; charset=UTF-8', true);
        // Only the browser session of the test may read the page: the audit must reuse its cookies.
        if ($this->request->getCookie('magelens_markup_session') !== 'signed-in') {
            return $result->setHttpResponseCode(403)->setContents($this->document('<p>Sign in</p>'));
        }
        // A browser repairs the misnested tags while parsing, so only the response source shows them.
        $second = $this->request->getParam('case') === 'invalid' ? '<b><i>Second</b></i>' : '<b><i>Second</i></b>';
        return $result->setContents($this->document("<p>First</p>\n<p>$second</p>"));
    }
    private function document(string $body): string
    {
        return "<!DOCTYPE html>\n<html lang=\"en\"><head><meta charset=\"utf-8\"><title>Markup probe</title></head><body>\n$body\n</body></html>";
    }
}
