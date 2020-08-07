import { ProxyModeType, ProxyServer, CompiledProxyRule } from "./definitions";
import { chrome } from "../lib/environment";
import { Debug } from "../lib/Debug";
import { Settings } from "./Settings";
import { ProxyRules } from "./ProxyRules";

export class ProxyEngineChrome {

    /**  Chrome only. Updating Chrome proxy config. */
    public static updateChromeProxyConfig() {

        if (Settings.current.proxyMode == ProxyModeType.SystemProxy) {
            // No need to generate PAC since this code does the job

            let config = {
                mode: "system"
            };
            chrome.proxy.settings.set(
                { value: config, scope: "regular" },
                function () {
                    if (chrome.runtime.lastError) {
                        Debug.error("updateChromeProxyConfig failed with ", chrome.runtime.lastError);
                    }
                });
            return;
        }
        else if (Settings.current.proxyMode == ProxyModeType.Direct) {
            let config = {
                mode: "direct"
            };
            chrome.proxy.settings.set(
                { value: config, scope: "regular" },
                function () {
                    if (chrome.runtime.lastError) {
                        Debug.error("updateChromeProxyConfig failed with ", chrome.runtime.lastError);
                    }
                });
            return;
        }

        // generate PAC script specific to Chrome
        let pacScript = this.generateChromePacScript();

        let config = {
            mode: "pac_script",
            pacScript: {
                data: pacScript
            }
        };
        chrome.proxy.settings.set(
            { value: config, scope: "regular" },
            function () {
                if (chrome.runtime.lastError) {
                    Debug.error("updateChromeProxyConfig failed with ", chrome.runtime.lastError);
                }
            });
    }

    private static generateChromePacScript(): string {
        var settings = Settings.current;

        //let proxyRules = settings.proxyRules;
        let compiledRules = ProxyRules.getCompiledRulesList();
        let compiledWhitelistRulesList = ProxyRules.getCompiledWhitelistRulesList();
        let proxyMode = settings.proxyMode;
        let resultActiveProxy = this.convertActiveProxyServer(settings.activeProxyServer);

        let compiledRulesAsString = this.regexHostArrayToString(compiledRules).join(",");
        let compiledWhitelistAsString = this.regexHostArrayToString(compiledWhitelistRulesList).join(",");
        let compiledBypass = JSON.stringify(settings.bypass);
        let pacTemplateString = `const proxyMode = "${proxyMode}";
const compiledRules = [${compiledRulesAsString}];
const compiledWhitelistRules = [${compiledWhitelistAsString}];
const bypass = ${compiledBypass};
const hasActiveProxyServer = ${((settings.activeProxyServer) ? "true" : "false")};
const ProxyModeType = {
    Direct: 0,
    SmartProxy: 1,
    Always: 2,
    SystemProxy: 3
}
const ProxyRuleType = {
    MatchPatternHost: 0,
    MatchPatternUrl: 1,
    RegexHost: 2,
    RegexUrl: 3,
    Exact: 4
}
const CompiledProxyRuleType = {
	RegexHost: 0,
	RegexUrl: 1,
	Exact: 2,
	SearchUrl: 3,	
	SearchDomain: 4,
	SearchDomainSubdomain: 5,
	SearchDomainAndPath: 6,
	SearchDomainSubdomainAndPath: 7
}
const resultActiveProxy = "${resultActiveProxy}";
const resultDirect = "DIRECT";
const resultSystem = "SYSTEM";
// -------------------------
// required PAC function that will be called to determine
// if a proxy should be used.
function FindProxyForURL(url, host) {
	// BUGFIX: we need implicit conversion (==) instead of (===), since proxy mode comes from different places and i'm lazy to track it
	if (proxyMode == ProxyModeType.Direct)
		return resultDirect;

    try {
        if (compiledWhitelistRules.length > 0)
            for (let i = 0; i < compiledWhitelistRules.length; i++) {
                let rule = compiledWhitelistRules[i];
                
                if (rule.regex.test(url))
                    return resultDirect;
            }
    } catch (e) {
        return "";
    }

	// in chrome system mode is not controlled here
	if (proxyMode == ProxyModeType.SystemProxy)
		// bypass list should be checked here if Chrome supported this model
		return resultSystem;

	// there should be active proxy
	if (!hasActiveProxyServer)
		// let the browser decide
        return "";
    
    host = host.toLowerCase();

	if (proxyMode == ProxyModeType.Always) {
		// should bypass this host?
		if (bypass.enableForAlways === true &&
			bypass.bypassList.indexOf(host) !== -1)
			return resultDirect;
		else
			return resultActiveProxy;
    }

    try {
        if (compiledWhitelistRules.length > 0)
            for (let i = 0; i < compiledWhitelistRules.length; i++) {
                let rule = compiledWhitelistRules[i];
                
                if (rule.regex.test(url))
                    return resultDirect;
            }

        let lowerCaseUrl;
        let schemaLessUrl;
        for (let i = 0; i < compiledRules.length; i++) {
            let rule = compiledRules[i];
            let matched = false;

            switch (rule.ruleType) {
                case ProxyRuleType.Exact:
                    if (lowerCaseUrl == null)
                        lowerCaseUrl = url.toLowerCase();

                    if (lowerCaseUrl == rule.ruleExact)
                        matched = true;
                    break;

                case ProxyRuleType.RegexHost:

                    if (rule.regex.test(host))
                        matched = true;
                    break;

                case ProxyRuleType.RegexUrl:

                    if (rule.regex.test(url))
                        matched = true;
                    break;

                case CompiledProxyRuleType.SearchUrl:

                    if (url.startsWith(rule.search))
                        matched = true;
                    break;

                case CompiledProxyRuleType.SearchDomain:

                    if (rule.search == host)
                        matched = true;
                    break;

                case CompiledProxyRuleType.SearchDomainSubdomain:

                    // domain
                    if (rule.search == host)
                        matched = true;

                    // subdomains
                    else if (host.endsWith('.' + rule.search))
                        matched = true;

                    break;

                case CompiledProxyRuleType.SearchDomainAndPath:

                    if (schemaLessUrl == null) {
                        schemaLessUrl = removeSchemaFromUrl(url);
                        if (schemaLessUrl == null) {
                            continue;
                        }
                        schemaLessUrl = schemaLessUrl.toLowerCase();
                    }

                    if (schemaLessUrl.startsWith(rule.search))
                        matched = true;

                    break;

                case CompiledProxyRuleType.SearchDomainSubdomainAndPath:

                    if (schemaLessUrl == null) {
                        schemaLessUrl = removeSchemaFromUrl(url);
                        if (schemaLessUrl == null) {
                            continue;
                        }
                        schemaLessUrl = schemaLessUrl.toLowerCase();
                    }

                    if (schemaLessUrl.startsWith(rule.search))
                        matched = true;

                    else {
                        
                        let ruleSearchHost = extractHostFromInvalidUrl(rule.search);
                        if (ruleSearchHost != null) {

                            // should be the same
                            if (ruleSearchHost != host)
                                continue;

                            // after this state, we are sure that the url is for the same domain, now just checking the path
                        }

                        // subdomains
                        if (schemaLessUrl.includes('.' + rule.search))
                            matched = true;
                    }
                    break;                    
            }

            if (matched) {
                if (rule.proxy)
                    // this rule has its own proxy setup
                    return rule.proxy;
                return resultActiveProxy;
            }
        }
    } catch (e) {
        return "";
    }

    // let the browser decide
	return "";
}

function removeSchemaFromUrl(url) {
    if (url == null)
        return url;
    let u = new URL(url);
    let schemaLength = (u.protocol + '//').length;

    return url.substr(schemaLength, url.length - schemaLength);
}
function extractHostFromInvalidUrl(url) {
    try {
        if (url.includes(":/")) {
            try {
                new URL(url);
                // url is valid
                return extractHostFromUrl(url);
            } catch { }
        }

        let urlFixed = 'http://' + url;
        return extractHostFromUrl(urlFixed);
    }
    catch (e) { return null; }
}
function extractHostFromUrl(url) {
    try {
        const u = new URL(url);
        let host = u.host;

        if (host.startsWith("www."))
            return host.substring(4, host.length);

        return host;
    }
    catch (e) { return null; }
}`;
        return pacTemplateString;
    };

    private static convertActiveProxyServer(proxyServer: ProxyServer): string {
        const resultDirect = "DIRECT";

        // invalid active proxy server
        if (!proxyServer || !proxyServer.host || !proxyServer.protocol || !proxyServer.port)
            return resultDirect;

        switch (proxyServer.protocol) {
            case "HTTP":
                return `PROXY ${proxyServer.host}:${proxyServer.port}`;

            case "HTTPS":
                return `HTTPS ${proxyServer.host}:${proxyServer.port}`;

            case "SOCKS4":
                return `SOCKS4 ${proxyServer.host}:${proxyServer.port}`;

            case "SOCKS5":
                return `SOCKS5 ${proxyServer.host}:${proxyServer.port}`;
        }

        // invalid proxy protocol
        return resultDirect;
    }

    private static regexHostArrayToString(compiledRules: CompiledProxyRule[]) {
        let compiledRulesAsStringArray = [];
        for (let index = 0; index < compiledRules.length; index++) {
            let rule = compiledRules[index];

            // TODO: check and ruleType compiledRuleType
            if (rule.proxy) {
                compiledRulesAsStringArray.push(`{search:${rule.search ?? 'null'},regex:${rule.regex?.toString() ?? 'null'},ruleType:${rule.compiledRuleType},proxy:"${this.convertActiveProxyServer(rule.proxy)}"}`);
            } else {
                compiledRulesAsStringArray.push(`{search:${rule.search ?? 'null'},regex:${rule.regex?.toString() ?? 'null'},ruleType:${rule.compiledRuleType}}`);
            }
        }
        return compiledRulesAsStringArray;
    }


}