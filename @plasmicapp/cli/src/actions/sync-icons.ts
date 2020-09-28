import L from "lodash";
import path from "upath";
import {
  PlasmicConfig,
  PlasmicContext,
  getContext,
  getOrAddProjectConfig,
  updateConfig,
  ProjectConfig,
} from "../utils/config-utils";
import { ProjectIconsResponse, IconBundle } from "../api";
import { writeFileContent, fixAllFilePaths } from "../utils/file-utils";
import { CommonArgs } from "..";
import { format } from "winston";
import { formatAsLocal, maybeConvertTsxToJsx } from "../utils/code-utils";
import { logger } from "../deps";
import * as semver from "../utils/semver";

export interface SyncIconsArgs extends CommonArgs {
  projects: readonly string[];
}

export async function syncIcons(opts: SyncIconsArgs) {
  const context = getContext(opts);
  fixAllFilePaths(context);

  const api = context.api;
  const config = context.config;

  const projectIds =
    opts.projects.length > 0
      ? opts.projects
      : context.config.projects.map((p) => p.projectId);

  const getVersionRange = (projectId: string) => {
    const projectConfig = context.config.projects.find(
      (x) => x.projectId === projectId
    );
    return projectConfig?.version ?? semver.latestTag;
  };

  const results = await Promise.all(
    projectIds.map((projectId) =>
      api.projectIcons(projectId, getVersionRange(projectId))
    )
  );
  for (const [projectId, resp] of L.zip(projectIds, results) as [
    string,
    ProjectIconsResponse
  ][]) {
    if (context.config.code.lang === "js") {
      resp.icons.forEach((icon) => {
        [icon.fileName, icon.module] = maybeConvertTsxToJsx(
          icon.fileName,
          icon.module
        );
      });
    }
    syncProjectIconAssets(context, projectId, resp.version, resp.icons);
  }

  updateConfig(context, config);
}

export function syncProjectIconAssets(
  context: PlasmicContext,
  projectId: string,
  version: string,
  iconBundles: IconBundle[]
) {
  const project = getOrAddProjectConfig(context, projectId);
  if (!project.icons) {
    project.icons = [];
  }
  const knownIconConfigs = L.keyBy(project.icons, (i) => i.id);
  for (const bundle of iconBundles) {
    logger.info(
      `Syncing icon: ${bundle.name}@${version}\t['${project.projectName}' ${project.projectId}/${bundle.id} ${project.version}]`
    );
    let iconConfig = knownIconConfigs[bundle.id];
    const isNew = !iconConfig;
    if (isNew) {
      iconConfig = {
        id: bundle.id,
        name: bundle.name,
        moduleFilePath: path.join(
          context.config.defaultPlasmicDir,
          L.snakeCase(`${project.projectName}`),
          bundle.fileName
        ),
      };
      knownIconConfigs[bundle.id] = iconConfig;
      project.icons.push(iconConfig);
    }

    writeFileContent(
      context,
      iconConfig.moduleFilePath,
      formatAsLocal(bundle.module, iconConfig.moduleFilePath),
      {
        force: !isNew,
      }
    );
  }
}
