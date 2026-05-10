import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { AutoUnpackNativesPlugin } from '@electron-forge/plugin-auto-unpack-natives';
import { WebpackPlugin } from '@electron-forge/plugin-webpack';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';
import fs from 'fs';
import path from 'path';

import { mainConfig } from './webpack.main.config';
import { rendererConfig } from './webpack.renderer.config';

const assetsIcon = path.join(__dirname, 'assets', 'icon');
const assetsIco = path.join(__dirname, 'assets', 'icon.ico');
const nsisSidebarBmp = path.join(__dirname, 'assets', 'installer-sidebar.bmp');
const nsisHeaderBmp = path.join(__dirname, 'assets', 'installer-header.bmp');
const deskoyWebhooksJson = path.join(__dirname, 'deskoy-webhooks.json');

// Ship the whole assets folder so any new branding images
// are present in production builds (e.g. tray/window icons, installer art).
const packagerExtraResources = [path.join(__dirname, 'assets')];
if (fs.existsSync(deskoyWebhooksJson)) {
  packagerExtraResources.push(deskoyWebhooksJson);
}

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    icon: assetsIcon,
    extraResource: packagerExtraResources,
  },
  rebuildConfig: {},
  makers: [
    // Windows: NSIS wizard installer (supports custom sidebar/header art)
    {
      name: '@felixrieseberg/electron-forge-maker-nsis',
      config: {
        getAppBuilderConfig: async () => ({
          artifactName: '${productName} Setup ${version} ${arch}.${ext}',
          win: {
            icon: assetsIco,
          },
          nsis: {
            oneClick: false,
            allowToChangeInstallationDirectory: true,
            include: path.join(__dirname, 'build', 'installer.nsh'),
            installerIcon: assetsIco,
            uninstallerIcon: assetsIco,
            installerSidebar: nsisSidebarBmp,
            installerHeader: nsisHeaderBmp,
            shortcutName: 'Deskoy',
            createDesktopShortcut: true,
            createStartMenuShortcut: true,
            runAfterFinish: true,
          },
        }),
      },
    },
    new MakerZIP({}, ['darwin']),
    new MakerRpm({}),
    new MakerDeb({}),
  ],
  plugins: [
    new AutoUnpackNativesPlugin({}),
    new WebpackPlugin({
      mainConfig,
      port: 3050,
      loggerPort: 9050,
      renderer: {
        config: rendererConfig,
        entryPoints: [
          {
            html: './src/index.html',
            js: './src/renderer.ts',
            name: 'main_window',
            preload: {
              js: './src/preload.ts',
            },
          },
          {
            html: './src/cover/excel.html',
            js: './src/cover/cover.ts',
            name: 'cover_excel',
          },
          {
            html: './src/cover/vscode.html',
            js: './src/cover/cover.ts',
            name: 'cover_vscode',
          },
          {
            html: './src/cover/docs.html',
            js: './src/cover/cover.ts',
            name: 'cover_docs',
          },
          {
            html: './src/cover/jira.html',
            js: './src/cover/cover.ts',
            name: 'cover_jira',
          },
          {
            html: './src/cover/bi.html',
            js: './src/cover/cover.ts',
            name: 'cover_bi',
          },
        ],
      },
    }),
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
