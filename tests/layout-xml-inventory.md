<!--
Copyright (c)  MageLens
SPDX-License-Identifier: Elastic-2.0
License: see LICENSE in the repository root.
-->

# Layout XML measurement inventory

The source review uses Magento Open Source 2.4.9 (commit `755e34dd689021c5165db9d35ecff74f7dc51527`) and Mage-OS 4.0.0 (commit `6baead3042bce450fc676038376dd71268531df9`). Sources include the framework layout, page layout registry and argument XSDs, the configured reader and generator pools in `app/etc/di.xml`, and the Theme, Backend, UI, CMS, Widget and PageCache integration paths. [Magento source](https://github.com/magento/magento2/tree/2.4.9) · [Mage-OS source](https://github.com/mage-os/mageos-magento2/tree/4.0.0) · [Adobe layouts](https://developer.adobe.com/commerce/frontend-core/guide/layouts/) · [Extensions](https://developer.adobe.com/commerce/frontend-core/guide/layouts/extend) · [Overrides](https://developer.adobe.com/commerce/frontend-core/guide/layouts/override) · [UI components](https://developer.adobe.com/commerce/frontend-core/ui-components/concepts/xml-declaration)

P is a page configuration file, G is a generic layout, and W is a page layout wireframe. Where an instruction is allowed through a nested type in W, the wireframe reader still controls whether it is used. Where two attributes share one row, their names are individually enumerated and the evidence rule applies to each. Internal nodes such as `layout_merged.xsd`'s `handle` are inspected for provenance but have no independent source coverage.

The evidence column states what would be needed to measure the effect. The fixture column identifies the ownership fixture or the outstanding fixture family. Static source review alone does not establish a platform pass.

## Files and providers

| Declaration or path | Files | Identity and native consumer | Evidence required | Fixture |
| --- | --- | --- | --- | --- |
| `page` root | P | Merge packages each file under its handle basename. Result Page applies the configured page pools | Selected package entry contributes a consumed instruction | Ownership |
| `page@layout` | P | Merge sets the layout when traversing each package entry. Later layout selection and programmatic configuration can supersede it | Page layout reader uses the winning declaration and obtains that wireframe | Handle fixture proves the original selector on the direct native path. Other interception paths require independent proof |
| `page@label` | P | Package handle label, read by Merge design-abstraction lookup | Original label returned through the lookup that consumes it | Registry pending |
| `page@design_abstraction` | P | Merge design-abstraction XPath filters on the value | Effective entry chosen for that lookup | Registry pending |
| `layout` root | G | Package entry by basename. Result Layout uses its generic reader | Generic HTTP result consumes the corresponding entry | Fragment pending |
| `layout` root | W | Page Layout Reader loads the selected handle using wireframe collectors and its separate merge cache | Selected wireframe parsed by its reader, with effective origin | Registry pending |
| `page_layouts/layout@id` | `layouts.xml` | PageLayout Config merges by ID | Exact ID used by a membership or option consumer | Registry pending |
| `page_layouts/layout/label` | `layouts.xml` | PageLayout Config extracts winning layout label | Original label reaches the rendered option | Registry pending |
| `label@translate` | `layouts.xml` | Config extracts text and ignores the flag when it creates options | Any later flag-dependent translation needs its own consumer | Registry pending |
| `page_types/type@id` | `page_types.xml` | PageType Config reader and option APIs | Effective ID consumed | Registry pending |
| `page_types/type@label` | `page_types.xml` | PageType Config conversion/option APIs | Original label consumed | Registry pending |
| Default handle | P/G | Request or result adds `default` | Native handle addition enters package traversal | Ownership uses a page result |
| Action handle | P/G | Result default-handle logic applies the route action name | Native handle addition enters package traversal | Ownership uses `coverageprobe_index_index` |
| Entity-specific or dynamic handle | P/G | Controller/helper or layout load event adds a named handle | Runtime addition traced to its provider | Dynamic handle pending |
| `update@handle` | P/G/W | Merge traverses included handle ahead of appending the enclosing XML | Uniquely identified include edge enters native recursion | Ownership includes base and overlay |
| Duplicate include | P/G/W | Merge's per-instance processed-handle map suppresses work | Native traversal distinguishes processed edge from duplicate | Handle precedence pending |
| Include cycle | P/G/W | Merge's processing state suppresses re-entry and logs in developer mode | Processing-state edge distinguished from processed duplicate | Handle precedence pending |
| Module `view/base` | P/G/W | Base collector supplies base-area inputs | Native selected physical file path and content | Provider pending |
| Module `view/frontend` | P/G/W | Base collector also supplies the active area's inputs | Native selected path in frontend context | Ownership |
| Module `view/adminhtml` | P/G/W | Base collector supplies Admin inputs in that area | Native selected path in Admin context | Admin pending |
| Module sequence | P/G/W | ModuleDependency decorator orders native file list | Actual ordered files through reader and effective winner | Overlay pending |
| Active theme extension | P/G/W | Aggregated adds modular files for inherited theme sequence | Selected theme file and resulting declaration | Theme precedence pending |
| Parent theme extension | P/G/W | Same collector includes parent before child | Parent file and surviving effect | Theme precedence pending |
| `override/base` | P/G/W | Aggregated replaces the base list entry | Replacement slot and omission of base origin | Theme precedence pending |
| `override/theme` | P/G/W | Aggregated replaces the specified ancestor's entry | Replacement slot and omission of ancestor origin | Theme precedence pending |
| Empty override | P/G/W | File-list replacement leaves a handle with no child updates | Replacement causally suppresses the displaced XML | Theme precedence pending |
| Inactive theme or disabled module | P/G/W | Theme area/ancestry and module output filtering can exclude files | Native provider exclusion in the effective context | Provider pending |
| Database and widget update | P/G | Merge asks for DB XML after each matching package handle. Widget customizes database update lookup | Dynamic append has distinct origin and masks displaced XML effects | Dynamic provider pending |
| CMS update | P | CMS can select layout or add inline and selectable updates | CMS selection/appends and any displaced origin traced | Dynamic provider pending |
| PHP XML update | P/G | Merge addUpdate and Layout setXml can introduce unrelated XML | Every unmapped append or XML replacement disqualifies affected origin | Dynamic provider pending |

## Structure

| Declaration or attribute | Files | Identity and native consumer | Evidence required | Fixture |
| --- | --- | --- | --- | --- |
| `block`, `block@name` | P/G, nested W grammar | ScheduledStructure Helper uses element identity, assigns anonymous names, and can replace a prior scheduled element | Effective schedule and successful generator result, separately from render | Ownership |
| `block@class`, `referenceBlock@class` | P/G, nested W grammar | Block reader merges attributes by block name. Generator uses the resulting class or default | Successful construction from the winning class origin | Structure pending |
| `container`, `container@name` | P/G/W | ScheduledStructure Helper and Generator Container build the structure | Final container created with the attributed identity | Structure pending |
| `referenceBlock@name`, `referenceContainer@name` | P/G/W where valid | Readers target schedule identity, including declarations that appear later | An attributable mutation of a realized target | Structure pending |
| `block@as`, `container@as`, `uiComponent@as` | P/G/W where valid | Helper schedules child alias in parent; move can change it | Final parent alias matches applied alias operation | Structure pending |
| `block@before`, `container@before`, `uiComponent@before` | P/G/W where valid | Helper schedules sibling position, with `after` taking precedence and `-` selecting the end position appropriate to direction | Realized position relative to valid sibling or edge | Structure pending |
| `block@after`, `container@after`, `uiComponent@after` | P/G/W where valid | Helper schedules sibling position and GeneratorPool sorts it | Realized position relative to valid sibling or edge | Structure pending |
| `block@group`, `referenceBlock@group` | P/G, nested W grammar | Reader merges group, Block generator registers it on parent | Group registration with original attribute | Structure pending |
| `block@output`, `container@output`, `uiComponent@output` | P/G/W where valid | Layout automatically outputs root containers. Any declared output effect must be confirmed per path | Observed output-list change caused by the attribute | Structure pending |
| `container@label`, `referenceContainer@label` | P/G/W | Container attribute merge and generator attribute transfer | Attribute reaches a structure/label consumer | Structure pending |
| `container@htmlTag`, `referenceContainer@htmlTag` | P/G/W | Container reader/generator, then Layout container rendering | Native wrapper uses winning tag | Structure pending |
| `container@htmlClass`, `referenceContainer@htmlClass` | P/G/W | Same attribute merge with rendered class on an emitted wrapper | Native wrapper uses winning class | Structure pending |
| `container@htmlId`, `referenceContainer@htmlId` | P/G/W | Same attribute merge with rendered ID on an emitted wrapper | Native wrapper uses winning ID | Structure pending |
| `move@element`, `move@destination` | P/G/W | Move reader queues by element. GeneratorPool moves before removing | Valid relocation, absent target, and removed destination distinguished | Structure pending |
| `move@as` | P/G/W | GeneratorPool resolves new alias or inherits prior alias | Alias update applied on successful move | Structure pending |
| `move@before`, `move@after` | P/G/W | Move reader converts positional attributes into scheduled sibling data | Effective destination order with a valid sibling or edge | Structure pending |
| `referenceBlock@remove`, `referenceContainer@remove` | P/G/W where valid | Reader adds or cancels scheduled removal. GeneratorPool removes existing subtree | Prior queued removal, cancellation and actual removal separately observed | Structure pending |
| Standalone `remove@name` | Intermediate grammar | Defined globally by elements XSD. Installed pools have no standalone remove reader | No native consumer in inspected default pools | Schema-only pending fixture |
| `referenceBlock@display`, `referenceContainer@display` | P/G/W where valid | Generator writes display onto structure, Layout checks it before render | Existing element and native visibility decision | Structure pending |
| `block@ifconfig`, `uiComponent@ifconfig` | P/G, nested W grammar | Condition parser and GeneratorPool remove elements when native condition denies | Allowed and denied boundary traced separately | Structure pending |
| `block@acl` | P/G, nested W grammar | Block reader maps deprecated ACL spelling to `aclResource` | Real Admin authorization using the alias | Admin pending |
| `block@aclResource`, `uiComponent@aclResource` | P/G, nested W grammar | Native ACL condition checked in the relevant reader/pool | Real permission result and corresponding presence/removal | Admin pending |
| `block@cacheable`, `uiComponent@cacheable` | P/G, nested W grammar | Layout isCacheable selects only block nodes whose attribute equals the literal false. The UI declaration cannot enter that XPath | Native page cache decision attributable to the selector, independent of TTL | Caches pending |
| `block@ttl`, `uiComponent@ttl` | P/G, nested W grammar | Block generator sets nonempty TTL; later cache handling depends on runtime path. UI generator needs separate verification | Native consumer applies an originating TTL in that path | Caches pending |
| `uiComponent`, `uiComponent@name` | P/G, nested W grammar | Reader schedules a component and can derive child layout elements from UI config. Generator creates and wraps component | Layout-owned placement and realized component, with standalone config origins excluded | UI component pending |
| `uiComponent@component` | P/G, nested W grammar | UI Generator passes the scheduled element name and a null component type to the factory | Default placement does not pass component to the factory. A customized consumer needs separate evidence | UI component pending |
| `uiComponent@group` | P/G, nested W grammar | UI generator registers the selected group on the parent | Group registration due to UI placement | UI component pending |
| `visibilityCondition@name`, `visibilityCondition@className` | UI placement | Native Condition reader and condition factory | Real invocation and decision from matching rule | UI component pending |
| `visibilityCondition/arguments` | UI placement | Condition reader parses values; factory resolves rule parameters | Applied parameters and original source leaf | UI component pending |

## Templates, actions and arguments

| Declaration or attribute | Files | Identity and native consumer | Evidence required | Fixture |
| --- | --- | --- | --- | --- |
| `block@template` | P/G, nested W grammar | Block reader stores the template by element name, Generator Block calls setTemplate | Source of the generator's effective assignment, with render evidence separate | Ownership |
| `referenceBlock@template` | P/G, nested W grammar | Reference overrides the existing scheduled attribute, including an equal value | Winning positional origin and corresponding native assignment | Ownership |
| Late PHP template change | Runtime | Template setters, constructors, layout preparation and rendering callbacks can replace selection | Native setter order and exact block instance at engine render | Ownership |
| Template file execution | Runtime | Template fetchView resolves file and invokes template engine for a valid file | Successful matching engine call, including successful empty output | Ownership |
| `action@method` | P/G, nested W grammar | Block reader appends action entries. Block generator calls the method after layout initialization | Actual successful call linked to one native scheduled entry. Equal call signatures stay ambiguous even when one guard suppressed a call | Arguments fixture |
| `action@ifconfig` | P/G, nested W grammar | Generator checks the native scope flag before calling the action | Attribute-level attribution needs the native guard result linked to its scheduled entry | Arguments fixture verifies native suppression and zero hits |
| `argument@name` | P/G, nested W grammar | Parser keys values by name. Block reader recursively overlays. Action generator uses ordered positional arguments | Native assignment proves application. Direct PHP data access and replacement can bypass public getters and setters | Arguments fixture proves primitive block-data assignments. Nested, action parameter and consumption attribution pending |
| `item@name` | P/G, nested W grammar | Array interpretation and recursive overlay keep individually surviving leaves | Each leaf's effective origin and native application | Arguments pending |
| `xsi:type="array"` | Layout values | ArrayType recursively delegates items | Parent origin only when unique, otherwise trace leaves individually | Arguments pending |
| `xsi:type="string"`, `string@translate` | Layout values | StringUtils interprets the value and optionally translates using a Phrase | Native value applied. Translation modifier needs a separate interpreter trace | Arguments fixture verifies translated and untranslated values and their assignments |
| `xsi:type="boolean"` | Layout values | Boolean interpreter | Native Boolean applied, including false | Arguments fixture |
| `xsi:type="number"` | Layout values | Number interpreter checks that XML text is numeric and returns the text | Native numeric string applied | Arguments fixture |
| `xsi:type="null"` | Layout values | NullType interpreter | Explicit null application distinguished from absent key | Arguments fixture |
| `xsi:type="object"`, `object@shared` | Layout values | Reader passthrough, generator DataObject chooses shared get or create | Successful application and independently verified identity semantics | Arguments pending |
| `xsi:type="options"`, `options@model` | Layout values | Options interpreter delegates to configured model | Model invocation and applied options result | Arguments pending |
| `xsi:type="url"`, `url@path`, `url/param@name` and value | Layout values | Generator URL interpreter and NamedParams | Route and named parameter application | Arguments pending |
| `xsi:type="helper"`, `helper@helper`, `helper/param@name` and value | File layout values | Generator HelperMethod interpreter. Protected custom layout update validation rejects this type where enabled | Actual helper call with the attributed parameters and applied result | Arguments pending |
| `xsi:type="serviceUrl"`, `serviceUrl@path`, `serviceUrl/param@name` and value | Schema | No serviceUrl entry in default Block reader or generator interpreter composite | Report unsupported on those installed composites. UI path requires separate proof | Schema-only pending fixture |
| `xsi:type="const"` | Page and merged schema | No const entry in default Block reader or generator composite. Magento UI registers a separate composite with Constant | Installed branch-specific interpreter and applied result | Schema-only pending fixture |
| `xsi:type="configurableObject"`, nested `argument` | Imported schema | Default Block composites omit it. Magento UI has a separate interpreter | Separate native interpreter proof for layout-owned UI data | UI component pending |
| `asoc` type | Imported schema | Declared without deriving from argumentType, so it is not a substitute for a layout argument | Schema validation of attempted xsi:type | Schema-only pending fixture |
| `updater` | File layout values | Block reader defers a parsed updater; the generator decorator applies it. The flat parser stops at nonblank text and discards sibling updater nodes in that mixed-content case | Native updater invocation or parser omission, with resulting value ownership | Magento native fixture proves an options updater and shows that a string's adjacent updater is ignored. Attribution pending |
| `updater@sortOrder`, `updater@enabled` | File layout values | Schema allows both modifiers. Interpreter path must be checked for each | An attributed native ordering or suppression effect | Arguments pending |
| `uiComponent/argument` | P/G, nested W grammar | UI reader does not parse placement arguments, and the generator passes context and structure to the factory. Standalone UI configuration supplies its own arguments | Any customized placement argument consumer needs proof | UI component pending |

## Page configuration and assets

| Declaration or attribute | Files | Identity and native consumer | Evidence required | Fixture |
| --- | --- | --- | --- | --- |
| `html/attribute@name` | P | HTML reader uses it as the element-attribute key | Original key reaches the native renderer | Head fixture verifies the emitted key. Attribution pending |
| `html/attribute@value` | P | HTML reader schedules the value. Page head generator applies it | Effective value reaches the renderer with attributable assignment history | Head fixture verifies the emitted value. Attribution pending |
| `head/attribute@name` | P/W grammar | Head reader uses it as the element-attribute key | Native head-specific output for the key | Head fixture verifies the emitted key. Attribution pending |
| `head/attribute@value` | P/W grammar | Head reader schedules the value, which can be replaced before rendering | Effective value with attributable assignment history | Head fixture verifies the emitted value. Attribution pending |
| `body/attribute@name` | P/W grammar | Body reader uses the key for normal attributes and selects its class path for `class` | Proven branch and emitted key | Head fixture verifies the emitted key and class output. Attribution pending |
| `body/attribute@value` | P/W grammar | Body reader schedules an attribute or adds a body class. Magento can append additional classes later | Effective attribute or surviving class from originating operation | Head fixture verifies the emitted value and surviving class. Attribution pending |
| `head/title` | P/W grammar | Structure replaces the title. Generator applies the final title to Page Config and Renderer consumes it | Effective title crossing render boundary, including superseded origins | Head fixture verifies the title and both original XML outcomes on the page path |
| `head/meta@name` | P/W grammar | Head reader derives the metadata key | Effective key and output choice | Head fixture verifies description and custom metadata output. Attribution pending |
| `head/meta@http-equiv` | P/W grammar | Default Head reader chooses name or property and does not use this attribute as key | Any HTTP-equiv effect needs separate evidence | Page output pending |
| `head/meta@charset` | P/W grammar | Default Head reader ignores this attribute. Renderer can handle a metadata entry named charset separately | Any effect of the charset attribute requires a native consumer | Page output pending |
| `head/meta@property` | Runtime extension | Head reader falls back to property when name is empty, although this attribute is absent in the pinned XSD | Effective property metadata emitted from an accepted declaration | Page output pending |
| `head/meta@content` | P/W grammar | Head reader passes content to structure | Effective metadata value emitted under the chosen key | Head fixture verifies description replacement. Attribution pending |
| `head/meta@scheme` | P/W grammar | Schema accepts it. Metadata setter passes key and content | Attribute-level consumption requires a native rendering proof | Page output pending |
| `head/css@src` | P/W grammar | Head reader stores by src and sets css type. Generator adds and renderer outputs asset groups | Emitted CSS reference attributable to surviving addition | Head fixture verifies deduplication by src. Attribution pending |
| `head/script@src` | P/W grammar | Same src identity with JS content type | Emitted script reference | Head fixture verifies local script reference. Attribution pending |
| `head/link@src` | P/W grammar | Same src identity. Generator may infer type from a local asset or choose a virtual remote link type | Emitted link reference | Head fixture verifies a deterministic remote alternate link. Attribution pending |
| `head/font@src` | P/W grammar | Same src identity with font type | Native font reference and group | Head fixture verifies a local font preload reference. Attribution pending |
| `head/remove@src` | P/W grammar | Head reader queues the src key and Head Generator processes removals before adding final assets | Actual removal from the collection or an observed absence at the same boundary | Head fixture verifies both effects and their original source attributes |
| Asset `@src_type` | P/W grammar | Generator chooses native remote or local path | Proven constructor/asset branch | Page output pending |
| Asset `@order` | CSS/link/font | Head generator separates service properties and HTML attributes. Renderer/group ordering needs independent proof | Observed effective group or position from this attribute | Page output pending |
| Asset `@ie_condition` | CSS/script/link/font | Head generator uses group property, renderer may wrap output | Actual native conditional group output | Page output pending |
| Asset `@media` | CSS/link/font | Head asset property and renderer/group path | Emitted media attribute or grouping effect | Head fixture verifies the effective media attribute. Attribution pending |
| Asset `@defer` | CSS/link/font/script | Head asset properties pass into output serialization. The renderer can also apply script deferral | Deferral attribute emitted from its XML source | Head fixture verifies explicit script deferral. Attribution pending |
| Asset `@async` | Script | Head asset properties pass into output serialization | Async attribute emitted from its XML source | Page output pending |
| Asset `@charset` | CSS/link/font/script | Head asset properties pass into output serialization | Surviving charset attribute | Page output pending |
| Asset `@type` | CSS/link/font/script | Head asset property assembly and renderer defaults both influence type | Explicit attribute and default type distinguished at output | Page output pending |
| Asset `@hreflang` | CSS/link/font | Head asset properties supply the link's language attribute | Surviving language attribute | Head fixture declares an alternate locale link. Attribution pending |
| Asset `@rel` | CSS/link/font | Head asset properties and renderer defaults both influence the link relation | Explicit and default relations distinguished at output | Head fixture verifies the alternate relation. Attribution pending |
| Asset `@rev` | CSS/link/font | Head asset properties supply the reverse relation attribute | Surviving reverse relation attribute | Page output pending |
| Asset `@sizes` | CSS/link/font | Head asset properties supply the link sizes attribute | Surviving sizes attribute | Page output pending |
| Asset `@target` | CSS/link/font | Head asset properties supply the target attribute | Surviving target attribute | Page output pending |
| Asset `@integrity` | CSS/link/font/script | Head asset properties supply the integrity attribute | XML-origin integrity attribute emitted by Magento | Page output pending |
| Asset `@crossorigin` | CSS/link/font/script | Head asset properties and font renderer defaults can both generate the attribute | XML-origin attribute distinguished from font defaults | Page output pending |
| Asset `@as` | CSS/link/font | Asset property assembly and renderer | Surviving preload resource type | Page output pending |

## Runtime boundaries

| Path | Evidence and limitation | Fixture |
| --- | --- | --- |
| Cold package, handle and scheduled layout | Observe native file, package entry, appended update, reader and generator. Printed XML or a matching final attribute by itself cannot identify a winning source | Ownership |
| Warm package, handle or schedule cache | Cached XML or scheduled data can omit source and winning attribute identity. Equal bytes can survive a provider change. Without fresh attributable cache lineage, runtime effects have unknown source | Caches pending |
| Warm block HTML cache | Block can still be constructed or selected. Cached HTML bypasses its template engine | Caches pending |
| Full-page cache | Builtin front controller or Varnish can serve the page before any builder. A PHP hook or DOM marker cannot prove fresh layout evidence | Caches pending |
| Programmatic source change | A PHP change can replace an equal-valued template or block. Track native assignment and object identity before crediting execution | Ownership includes differing late PHP template |
| Failed template rendering | Template fetch can yield an empty string after validation failure; observe the engine rather than testing text. Mage-OS additionally avoids caching a failed template render | Caches pending |
| Multiple layout instances | Merge, reader context, generation target and block instance must stay correlated per layout. Reused block names do not identify instances | Caches pending |
| Warm-up and zero hits | Coverage authorization must exclude warm-up. Inventory must still retain unvisited declarations | Ownership has a separate unvisited handle |
| Standalone UI component XML | Separate configuration readers, file providers and merge identities. Layout placement evidence cannot credit implementation config declarations | UI component pending |

## Source comparison

The 11 inspected XSDs matched byte for byte between the Composer-installed platforms. The installed `app/etc/di.xml` orders also matched for the generic readers (container, block, move and UI component), the page readers (HTML, head and body), and the generators (head, body, block, container and UI component). Both block argument composites register options, array, Boolean, number, string, null, object, URL and helper in the same order. The installed Admin configuration selects the same backend block reader preference and page reader pool on both platforms. Runtime verification covers the installed call paths described below.

## Verified runtime evidence

| Slice | Magento Open Source 2.4.9 | Mage-OS 4.0.0 with Hyvä CSP and Playwright |
| --- | --- | --- |
| Ownership | Pinned Composer install and developer HTTP proved the block and effective template, equal-valued XML override, late PHP replacement and zero-hit declarations. The exact checks failed before recognizing the generated interceptor's native append frame and passed after it | Developer and production browser runs proved the base Blog block, Hyvä template, equal-valued XML override, late PHP setter and unvisited handle. The original collector lacked the block origin. The exact ownership assertions passed after instrumentation |
| Handle inclusion | Developer HTTP verified traversed, duplicate and cyclic handle edges through the installed merge | Developer and production browser runs proved ordered inclusion and dynamic handle content. Exact evidence distinguishes a traversed edge, a duplicate and an active cycle. The include origin assertion failed before the inclusion hooks |
| Wireframe and registry | Developer and compiled HTTP verified the original selector and selected wireframe after the collector distinguished the generated no-plugin fallback from a customized getter | The latest developer run verified the original selector and selected file. Native output proved the registry label. Registry label attribution requires a separate registry consumer hook |
| Structure | Developer HTTP verified applied, removed-subtree and missing-target move outcomes, plus removal, cancellation and restoration with their original XML | Native HTML and layout queries proved sibling order, a new alias, nested containers, a successful move, an absent move target, a moved child removed with its destination, cancellation and display suppression. The move and removal assertions failed before instrumentation. Developer and production runs verified the original moves. The final production probe verified original removal and restoration attributes, including the canceled removal. The report retains the individual move attributes, wrapper and sibling effects, and display decisions with their limitations |
| Arguments and actions | Native HTTP verified all 15 markers in the typed argument and action fixture. Exact call and scalar assignment assertions failed before the native hooks. Developer and production verified original action calls, guarded zero hits, ambiguous equal calls and assignments for string, number, Boolean and null, including unread and subsequently replaced values | Developer run passed the same native fixture and exact report assertions |
| Page configuration | Developer browser run verified the original fixture before collector changes. The first exact title assertion failed for lack of provenance. Developer and production reports verified the rendered and superseded titles and separated a real asset removal from an absent target | Developer run passed the same native fixture and exact report assertions |
| Admin layout | Existing Blog Admin list and editor journeys verified original selector, block and template outcomes in `adminhtml/Magento/backend` | Existing Blog Admin list and editor journeys verified the same effects in `adminhtml/MageOS/m137-admin-theme` |
| Warm layout cache | The production HTTP probe primed the layout without authorization. A fresh collection recorded one authorized request that still rendered the title, with zero layout hits and explicit cache provenance warnings. The warnings survived report validation | With the layout cache enabled, the measured ownership fixture requests produced zero layout hits and reported unavailable original provenance. Effective selected blocks can therefore remain unmeasured even when they render |
| Existing collectors | PHP report, XML config merge, observer and plugin proofs, developer and compiled DI hook proofs, and cold, warm and stale preference proofs passed against the Composer install | Existing XML, native hook, observer, plugin, developer and compiled DI proofs passed using the pinned PHP image and Composer-installed Mage-OS source |

For an exact report check, use a disposable Hyvä CSP installation with the compatibility fixtures and `vendor/hyva-themes/magento2-default-theme-csp` in `vendorRoots`. Disable the layout cache explicitly with `bin/magento cache:disable layout` and run `./bin/run-coverage`. Run `node tests/verify-layout-<family>.cjs` with `ownership`, `handles`, `moves`, `removals`, `actions`, `arguments` and `head`. The Admin check takes an explicit platform with `node tests/verify-layout-admin.cjs magento` or `node tests/verify-layout-admin.cjs mageos`. The production runs used the separate compiled deployment path.

The complete local Hyvä CSP developer report comparison used Playwright and Chrome for Testing 157.0.8103.78 on both installed platforms. Both reports credit 251 of 1,275 eligible layout declarations. The initial comparison exposed missing ownership for three Magento template assignments that passed through generated interceptors. The exact vendor-template test reproduced those omissions and passed when the collector recognized the native fallbacks. Three XML files still differ. Both Blog Admin layout files report their actual platform-specific themes, and Hyvä's `Magento_Theme/layout/default.xml` reports PHP engine execution for the `page.main.title` template on Magento. The Mage-OS run recorded that template selection without execution evidence. PHP, JavaScript and template coverage snapshots match in this comparison.

Both Magento Open Source application modes passed all eight browser scenarios and the exact source checks. Their complete developer and production snapshots match. Mage-OS passed all eight scenarios and the exact source checks in developer mode. The earlier Mage-OS production run covered the ownership, handle and structural fixtures. The latest title, asset, action and scalar argument cases require a Mage-OS production rerun. The local browser runs used the Hyvä CSP storefront, Playwright and the pinned Chrome for Testing build. The hosted matrix remains pending review, including the Luma, Cypress and Windows cases.

Open fixture and evidence rows include theme extension and replacement, registry lookup origins, container creation and structural attributes, visibility decisions, complex argument interpretation and application, later value consumption, action guard attribution, metadata and element attributes, asset additions, generic fragments, Admin block ACL, UI-component placement, block cache, full-page cache and stale cache lineage. The report can identify an original action call while its guard decision and parameter origins remain unmeasured. Likewise, a native head fixture can prove a final resource reference while the collector lacks a source trace through asset grouping and rendering.
