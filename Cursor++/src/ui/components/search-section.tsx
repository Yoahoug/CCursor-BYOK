import { CustomSelect } from './custom-select'
import { Modal } from './modal'

const SEARCH_PROVIDERS = [
  { type: 'tavily', name: 'Tavily', needsKey: true, supportsBaseUrl: true, hint: 'Search results tuned for LLMs — 1,000 free calls per month, supports a custom Base URL' },
  { type: 'duckduckgo', name: 'DuckDuckGo', needsKey: false, supportsBaseUrl: false, hint: 'Free fallback — often blocked by anti-bot (returns 202)' },
] as const

const FETCH_PROVIDERS = [
  {
    type: 'tavily',
    name: 'Tavily Extract',
    hint: 'Server-side fetch — gets past the Cloudflare challenge pages the built-in fetcher cannot. Reuses the key and Base URL from the Search tab.',
    reusesSearchConfig: true,
  },
  {
    type: 'builtin',
    name: 'Built-in (supermarkdown)',
    hint: 'Local HTML → Markdown, zero config. Cannot fetch sites behind Cloudflare (linux.do returns 403, for example).',
    reusesSearchConfig: false,
  },
] as const

export function WebToolsButton() {
  return (
    <button
      class="search-btn"
      x-on:click="$store.app.webToolsOpen = true"
      title="Configure search and web fetch providers"
    >
      Web Tools
    </button>
  )
}

export function WebToolsDialog() {
  return (
    <Modal showExpr="$store.app.webToolsOpen" title="Web Tools">
      <div class="wt-tabs">
        <button
          class="wt-tab"
          x-bind:class="{ active: $store.app.webToolsTab === 'search' }"
          x-on:click="$store.app.webToolsTab = 'search'"
        >
          Search
        </button>
        <button
          class="wt-tab"
          x-bind:class="{ active: $store.app.webToolsTab === 'fetch' }"
          x-on:click="$store.app.webToolsTab = 'fetch'"
        >
          Fetch
        </button>
      </div>

      {/* ── 搜索 ── */}
      <div x-show="$store.app.webToolsTab === 'search'">
        <div class="search-providers">
          {SEARCH_PROVIDERS.map(sp => (
            <div class="search-provider-card" key={sp.type}>
              <div class="search-provider-row">
                <div class="search-provider-info">
                  <span class="search-provider-name">{sp.name}</span>
                  <span class="search-provider-hint">{sp.hint}</span>
                </div>
                <label class="qs-switch">
                  <input
                    type="checkbox"
                    x-bind:checked={`$store.app.isSearchProviderEnabled('${sp.type}')`}
                    x-on:change={`$store.app.toggleSearchProvider('${sp.type}', $event.target.checked)`}
                  />
                  <span class="qs-switch-track"></span>
                  <span class="qs-switch-knob"></span>
                </label>
              </div>
              <div class="search-provider-key" x-show={`$store.app.isSearchProviderEnabled('${sp.type}')`}>
                {sp.needsKey && (
                  <input
                    type="password"
                    placeholder="API Key"
                    x-bind:value={`$store.app.getSearchProviderKey('${sp.type}')`}
                    x-on:input={`$store.app.setSearchProviderKey('${sp.type}', $event.target.value)`}
                    autocomplete="off"
                  />
                )}
                {sp.supportsBaseUrl && (
                  <>
                    <input
                      type="text"
                      placeholder="Base URL (optional) — e.g. https://api.tavily.com"
                      x-bind:value={`$store.app.getSearchProviderBaseUrl('${sp.type}')`}
                      x-on:input={`$store.app.setSearchProviderBaseUrl('${sp.type}', $event.target.value)`}
                      autocomplete="off"
                      style="margin-top:4px"
                    />
                    <div class="search-provider-actions">
                      <button
                        type="button"
                        class="search-test-btn"
                        x-on:click={`$store.app.testSearchProvider('${sp.type}')`}
                        x-bind:disabled="$store.app.searchTesting"
                      >
                        <span x-show="!$store.app.searchTesting">Test connection</span>
                        <span x-show="$store.app.searchTesting">Testing…</span>
                      </button>
                      <span
                        class="search-test-result"
                        x-bind:class="'level-' + ($store.app.searchTestResult?.level || 'none')"
                        x-text="$store.app.searchTestResult?.text || ''"
                      />
                    </div>
                  </>
                )}
              </div>
            </div>
          ))}
          <div class="search-options">
            <label class="check" title="Query all enabled providers in parallel and merge the results">
              <input
                type="checkbox"
                x-bind:checked="$store.app.webTools?.search?.parallel === true"
                x-on:change="$store.app.setSearchOption('parallel', $event.target.checked)"
              />
              {' Parallel search'}
            </label>
            <div class="search-max-results">
              <label>Max results</label>
              <CustomSelect
                valueExpr="String($store.app.webTools?.search?.maxResults || 5)"
                changeExpr="$store.app.setSearchOption('maxResults', Number($value))"
                options={[
                  { value: '5', label: '5' },
                  { value: '10', label: '10' },
                  { value: '15', label: '15' },
                  { value: '20', label: '20' },
                  { value: '25', label: '25' },
                ]}
              />
            </div>
          </div>
          <div class="search-options" style="border-top:none;padding-top:0;margin-top:8px">
            <label
              class="check"
              title="When every configured provider fails, fall back to scraping DuckDuckGo. DDG frequently returns an anti-bot page (HTTP 202); this implementation detects that and reports an error instead of treating junk links as results."
            >
              <input
                type="checkbox"
                x-bind:checked="$store.app.webTools?.search?.fallbackToDuckDuckGo !== false"
                x-on:change="$store.app.setSearchOption('fallbackToDuckDuckGo', $event.target.checked)"
              />
              {' Fall back to DuckDuckGo'}
            </label>
          </div>
        </div>
      </div>

      {/* ── 抓取 ── */}
      <div x-show="$store.app.webToolsTab === 'fetch'">
        <div class="fetch-providers">
          {FETCH_PROVIDERS.map(fp => (
            <div class="fetch-provider-card" key={fp.type}>
              <label class="fetch-provider-row">
                <input
                  type="radio"
                  name="fetch-provider"
                  value={fp.type}
                  x-bind:checked={`$store.app.webTools?.fetch?.provider === '${fp.type}'`}
                  x-on:change={`$store.app.setFetchProvider('${fp.type}')`}
                />
                <span class="search-provider-name">{fp.name}</span>
              </label>
              <div class="fetch-provider-hint">{fp.hint}</div>
              {fp.reusesSearchConfig && (
                <div
                  class="fetch-provider-reuse"
                  x-show="$store.app.webTools?.fetch?.provider === 'tavily'"
                >
                  <div
                    class="fetch-provider-reuse-status"
                    x-bind:class="'level-' + $store.app.fetchCredentialStatus.level"
                  >
                    <span x-text="$store.app.fetchCredentialStatus.text" />
                  </div>
                  <button
                    type="button"
                    class="fetch-provider-goto-search"
                    x-on:click="$store.app.webToolsTab = 'search'"
                  >
                    Change it on the "Search" tab
                  </button>
                  <div class="search-provider-actions">
                    <button
                      type="button"
                      class="search-test-btn"
                      x-on:click="$store.app.testFetchProvider()"
                      x-bind:disabled="$store.app.fetchTesting"
                    >
                      <span x-show="!$store.app.fetchTesting">Test connection</span>
                      <span x-show="$store.app.fetchTesting">Testing…</span>
                    </button>
                    <span
                      class="search-test-result"
                      x-bind:class="'level-' + ($store.app.fetchTestResult?.level || 'none')"
                      x-text="$store.app.fetchTestResult?.text || ''"
                    />
                  </div>
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div class="search-dialog-actions">
        <button x-on:click="$store.app.saveWebTools()">Save</button>
        <button class="ghost" x-on:click="$store.app.webToolsOpen = false">Cancel</button>
      </div>
    </Modal>
  )
}
