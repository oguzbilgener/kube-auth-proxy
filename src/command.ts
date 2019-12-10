import * as k8s from '@kubernetes/client-node';
import _ from 'lodash';
import { parseCommandLineArgs } from './args';
import authModules from './authModules';
import { DEFAULT_METRICS_PORT, readConfig, validateConfig } from './config';
import ForwardTargetManager from './ForwardTargetManager';
import { startMetricsServer } from './metrics';
import { startServer as startProxyServer } from './server/index';
import { CompiledForwardTarget, compileForwardTarget } from './Targets';
import * as log from './utils/logger';

async function start() {
    const cliOptions = await parseCommandLineArgs();
    // If there was a logLevel specified in the CLI, use it right away.
    if (cliOptions.logLevel) {
        log.setLevel(cliOptions.logLevel);
    }

    const fileConfig = await readConfig(cliOptions.config);

    const rawConfig = _.merge(fileConfig, cliOptions);
    const config = validateConfig(rawConfig);
    if (config.logLevel) {
        log.setLevel(config.logLevel);
    }

    const enabledAuthModles = authModules.filter(module => module.isEnabled(config));
    log.info(`Enabled authentication modules: ${enabledAuthModles.map(m => m.name).join(', ')}`);

    let kubeConfig: k8s.KubeConfig | undefined;
    if (!cliOptions.noK8s) {
        log.info('Loding Kubernetes configuration.');
        kubeConfig = new k8s.KubeConfig();
        kubeConfig.loadFromDefault();
    }

    const k8sApi = kubeConfig ? kubeConfig.makeApiClient(k8s.CoreV1Api) : undefined;
    const defaultTargets: CompiledForwardTarget[] = [];
    for (const defaultTarget of config.defaultTargets) {
        defaultTargets.push(
            await compileForwardTarget(k8sApi, defaultTarget, config.defaultConditions)
        );
    }

    // Watch Kubernetes for services to proxy to.
    const forwardTargets = new ForwardTargetManager(defaultTargets, {
        kubeConfig,
        domain: config.domain,
        namespaces: config.namespaces,
    });

    startProxyServer(config, forwardTargets, authModules);
    startMetricsServer(config.metricsPort || DEFAULT_METRICS_PORT);
}

start().catch(err => {
    log.error(err);
});
