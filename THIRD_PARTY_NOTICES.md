# Third-party notices

Deskoy's GPLv3 licence applies to Deskoy-authored source and assets, not to
third-party packages. JavaScript and Rust dependencies are resolved from the
committed `package-lock.json`, `src-tauri/Cargo.lock`, and `cli/Cargo.lock`;
their upstream licence terms and notices remain in force. This source export
does not vendor `node_modules` or Cargo registry source.

## ReUI component reference

Parts of the settings interface were developed using ReUI component patterns.
We retain this notice for any adapted ReUI material:

MIT License

Copyright (c) 2025 Keenthemes Inc

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.

Upstream: https://github.com/keenthemes/reui/blob/main/LICENSE.md

## Direct package dependencies

The following SPDX expressions come from the committed lockfiles. They are an
index, not a replacement for the packages' own notices.

| JavaScript package | Licence |
| --- | --- |
| `@tauri-apps/api`, `@tauri-apps/cli` | Apache-2.0 OR MIT |
| `react`, `react-dom`, `thinking-orbs` | MIT |
| `@types/react`, `@types/react-dom`, `@typescript-eslint/eslint-plugin` | MIT |
| `@typescript-eslint/parser` | BSD-2-Clause |
| `@vitejs/plugin-react`, `bmp-js`, `eslint`, `eslint-plugin-import` | MIT |
| `png-to-ico`, `pngjs`, `vite` | MIT |
| `sharp`, `typescript` | Apache-2.0 |

| Rust crate | Licence |
| --- | --- |
| `base64`, `rand`, `reqwest`, `serde`, `serde_json`, `sha2`, `thiserror`, `url`, `windows`, `windows-sys` | MIT OR Apache-2.0 |
| `tauri`, `tauri-build`, `tauri-plugin-global-shortcut`, `tauri-plugin-notification`, `tauri-plugin-updater` | Apache-2.0 OR MIT |
| `ed25519-dalek` | BSD-3-Clause |
| `open`, `rfd`, `tokio` | MIT |

The locked Rust graph also includes `cssparser`, `cssparser-macros`,
`dtoa-short`, `option-ext`, and `selectors` under MPL-2.0. Preserve the MPL
notices and source-availability obligations for those components in any
binary distribution. The optional `r-efi` dependency offers MIT or Apache-2.0
alternatives as well as LGPL-2.1-or-later.

Product names represented by built-in covers, including Excel, Google Docs,
Jira, and VS Code, are trademarks of their respective owners. Deskoy is not
affiliated with or endorsed by them.
