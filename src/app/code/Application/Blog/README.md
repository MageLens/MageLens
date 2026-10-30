# MageLens demonstration blog

`Application_Blog` is a sample application for [MageLens](../../../../../README.md). Its PHP controllers, Magento Admin forms, browser JavaScript, and Knockout/Alpine templates provide examples for all three coverage reports.

Equivalent browser scenarios live in `Test/Cypress/` and `Test/Playwright/`; fixture creation, cleanup, and Cypress patches are managed by `Test/MageLens/hooks.php`. See [Use your project](../../../../../docs/coverage.md#use-your-project) to add your own modules and tests.

## Try the demo

From the repository root, run `./install.sh`, then `./bin/run-coverage`. Add `--mageos` for Mage-OS instead of Magento Open Source, `--hyva` for Hyvä CSP, and `--playwright` to use Playwright with any theme. The Blog features and five acceptance scenarios are the same in all eight combinations.

- Storefront: **https://magelens.test/blog/**.
- Magento Admin: **https://magelens.test/admin/**; local demo credentials are `application` / `ApplicationOnly123456!`.
- Live runner (Cypress or Playwright): **https://magelens.test:6080/**.
- In Admin, open **Blog → Posts**, **Categories**, or **Comments**.
- Reports: open `coverage/index.html` from the repository root after the coverage command finishes.

Use the domain and ports configured in `.env` if you changed the defaults. Installation creates three starter articles once and preserves editorial changes on reruns.

## Demo features

- **Categories:** create, rename, enable or disable categories. An inactive category hides its articles. Move or delete its posts before deleting the category.
- **Posts:** manage title, URL slug, author, summary, plain-text body, category, SEO metadata, and a featured JPEG/PNG image (maximum 5 MB). Admin includes search, pagination, article preview, and word count. Image replacement/removal deletes the previous owned file.
- **Publishing:** save a draft, choose Published for immediate publication, or set a future publication time in **UTC**. Visibility is evaluated on each request, so scheduled posts do not require cron. Draft, future, missing, and inactive-category article URLs return 404.
- **Readers:** search and filter articles, paginate results, expand a quick read, open full article pages, and save favorites in browser storage. Search and category selections survive reloads through URL parameters.
- **Comments:** readers submit a name, private email, and plain-text comment. Comments stay pending until approved in Admin; editors can approve, reject, or delete them. A honeypot and a one-minute session/email cooldown limit repeated submissions. HTML in articles and comments is displayed as text.

Admin uses Magento's normal login, Blog ACL permission, secret URL keys, and form-key validation. Writes use POST, including deletion, which asks for confirmation. Grant **Manage Blog** in an Admin role to allow editing; a dashboard-only role cannot access Blog management. Uploaded files are validated as images and stored under random names in `pub/media/application/blog/`.

Content is shared across this installation's store views, with one category per post. Articles and comments use plain text. This demo is intended for local development.

Installation selects Luma by default or Hyvä CSP with `--hyva`. The Blog uses Knockout on Luma and Alpine on Hyvä. To use the included Luma demonstration theme, select `Application/coverage` in **Content → Design → Configuration**. Both browser suites support these themes; the journal note is checked only for the demo theme. Reports follow the selected themes and their local parents, excluding inactive themes and `vendor`.

## What the browser suites verify

Five tests exercise storefront discovery, favorites, pagination, publication visibility, Admin creation/editing/deletion, image upload/removal, SEO output, moderated comments, input validation, escaped output, CSRF rejection, and restricted-role authorization. They use real Magento forms and HTTP requests. One test publishes an article in Admin, reads it on the storefront, submits and moderates a comment, and removes its records.

Each run creates uniquely named fixtures and a temporary dashboard-only Admin account. Cleanup removes that run's posts, comments, images, categories, user, and role, preserving ordinary application content. Fixture metadata in Magento's `var/` allows the next run to clean up after an interrupted process.

## Source layout

| Path | Demonstrates |
| --- | --- |
| `Model/`, `ViewModel/` | Publishing rules, validation, and data access |
| `Controller/`, `Block/` | Storefront HTTP requests and Magento Admin actions |
| `etc/`, `Setup/` | Module configuration, declarative schema, and initial demo articles |
| `view/frontend/` | PHP page templates, Knockout/Underscore templates for Luma, and Alpine JavaScript/directives for Hyvä |
| `view/adminhtml/` | Admin forms, preview JavaScript, and browser templates |
| [Demo theme](../../../design/frontend/Application/coverage/) | Magento Blank extension, LESS styles, and the `theme-note.html` browser template |

Edit these tracked files under `src/`. Coverage instruments disposable copies and verifies the originals afterward. Rerun `./install.sh` with the same platform, theme and runner flags after changes to refresh application setup and assets.
