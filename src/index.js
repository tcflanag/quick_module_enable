Hooks.once("ready", quick_enable_init)

var manifest_mismatch_mods = {}


//CONFIG.debug.quick_module_enable =true


function ver_check(query, mod) {
    query.json().then(modules => {
        if (modules.manifest === null)
            return
        manifest_mismatch_mods[modules.manifest.name] = modules.manifest
        game.settings.set('quick-module-enable', 'manifestChecker', manifest_mismatch_mods)
    })
}

async function quick_enable_init() {
    if (!game.user.isGM) return
    const history_size = 10

    game.settings.register('quick-module-enable', "previousModules", {
        scope: "world",
        type: Object,
        default: [],
        config: false,
        onChange: s => { }
    });
    game.settings.register('quick-module-enable', "manifestChecker", {
        scope: "world",
        type: Object,
        default: [],
        config: false,
        onChange: s => { }
    });
    game.settings.register('quick-module-enable', "manifestCheckerDate", {
        scope: "world",
        type: Number,
        default: 0,
        config: false,
        onChange: s => { }
    });

    //game.settings.set('quick-module-enable', 'manifestCheckerDate', 0)

    //Get current mod list
    var modVer = {}
    for (const mod of game.data.modules) {
        modVer[mod.id] = { version: mod.data.version }
    }

    //Get mod history
    var modHistory = game.settings.get('quick-module-enable', 'previousModules')

    // Initialize history if empty
    if (modHistory.length === 0) modHistory.push(modVer)
    while (modHistory.length <= history_size) modHistory.unshift(modHistory[0])
    while (modHistory.length > history_size) modHistory.shift()

    // Update history
    modHistory.shift() // Delete the oldest data
    modHistory.push(modVer) // Add this runs data to the stack
    await game.settings.set('quick-module-enable', 'previousModules', modHistory)

    // Monkeypatch to reuse the existing Modmanagment API
    ModuleManagement.prototype.realGetData = ModuleManagement.prototype.getData
    ModuleManagement.prototype.getData = getQuickEnableData

    // Check if there are any new mods, and display the manager if so
    var oldVer = modHistory.slice(-2)[0] // Second to last elemet is state at previous load
    var changes = false
    for (const mod of Object.keys(modVer)) {
        if (!(mod in oldVer)) {
            changes = true
            console.log("quick-module-enable - ", mod, " added version ", modVer[mod]["version"])
        }
        if (mod in modHistory[0] && modVer[mod]["version"] !== modHistory[0][mod]["version"]) {
            console.log("quick-module-enable - ", mod, " version change from ", modHistory[0][mod]["version"], " to ", modVer[mod]["version"])
        }
    }
    if (changes) {
        var b = new ModuleManagement();
        b._filter = "recent"  // Default the dissplay to the "Recent" tb
        b._quick_install_mode = true // Auto enable new mods
        b.render(true);
    }
}


function getQuickEnableData(options) {
    var data = this.realGetData(options) // Don't want to copy the bulk of this function for compatability.
    var counts_recent = 0
    var counts_major = 0
    var counts_minor = 0
    const modVer = game.settings.get('quick-module-enable', 'previousModules')[0] // Element 0 is oldest, so check it for version
    const newMod = game.settings.get('quick-module-enable', 'previousModules').slice(-2)[0] // Second to last elemet is state at previous load

    if (typeof ForgeVTT !== "undefined") {
        if (Date.now() - game.settings.get('quick-module-enable', 'manifestCheckerDate') > 1000 * 60 * 60 * 24) {  // 1 day
            manifest_mismatch_mods = {}
            // Only run this when if the module tool is opened.
            for (const mod of game.data.modules) {
                fetch("https://forge-vtt.com/api/bazaar/manifest/" + mod.data.name + "?coreVersion=" + game.data.version).catch((e) => { console.error(e) }).then(query => ver_check(query, mod))
            }
            game.settings.set('quick-module-enable', 'manifestCheckerDate', Date.now())
        }


        var cached_data = game.settings.get('quick-module-enable', 'manifestChecker')
        var error_list = []
        var local_only = data.modules.reduce((arr, m) => {
            if (cached_data[m.name] === undefined) {
                console.log("QuickModuleEnable - Local only mod", m.name)
                return arr.concat([m]);
            }
            return arr
        }, []);

        var reinstall = data.modules.reduce((arr, m) => {
            if ((cached_data[m.name] !== undefined && m.manifest != cached_data[m.name].manifest)
            && m.version > cached_data[m.name].version) {
                console.group("QuickModuleEnable - Manifest Mismatch", m.title)
                console.log("Local manifest :", m.manifest, m.version)
                console.log("Latest manifest:", cached_data[m.name].manifest, cached_data[m.name].version )
                console.groupEnd()
                return arr.concat([m]);

            }

            return arr
        }, []);


        if (local_only){
            error_list.push({ title: "----------------------- Non-Public Modules -----------------------" })
            error_list = error_list.concat(local_only)
        }
        if (reinstall) {
            error_list.push({ title: "---------- Manifest not matching latest public version ----------" })
            error_list = error_list.concat(reinstall)
        }
    }


    // Count loop is seperate from filter loop so that count is always correct
    // Othewise, since I'm using the output of the real GetData function (above), the count would change depending on those filters too
    for (var m of game.data.modules) {

        var isNew = !(m.data.name in newMod)
        var isUpdated = !(m.data.name in modVer && modVer[m.data.name]["version"] === m.data.version)
        if (isUpdated || isNew) {
            counts_recent++;
        }
        var isMinor = m.data.compatibleCoreVersion >= game.data.version
        var isMajor = m.data.compatibleCoreVersion.slice(0, -1) >= game.data.version.slice(0, -1)
        if (!isMajor) counts_major++
        if (!isMinor && isMajor) counts_minor++
    }

    if (this._filter === "minor") {
        data.modules = data.modules.reduce((arr, m) => {
            var isMinor = m.compatibleCoreVersion >= game.data.version
            var isMajor = m.compatibleCoreVersion.slice(0, -1) >= game.data.version.slice(0, -1)
            if (isMinor || !isMajor) return arr
            return arr.concat([m]);
        }, []);
    }

    if (this._filter === "major") {
        data.modules = data.modules.reduce((arr, m) => {
            var isMajor = m.compatibleCoreVersion.slice(0, -1) >= game.data.version.slice(0, -1)
            if (isMajor) return arr
            return arr.concat([m]);
        }, []);
    }
    if (this._filter === "error") {
        data.modules = error_list
        data.editable = false
    }

    // Filter the list when "recent" is chosen to just have new or updated
    // Pre-check the new mods if this is the startup display
    if (this._filter === "recent") {
        data.modules = data.modules.reduce((arr, m) => {

            var isNew = !(m.name in newMod)
            var isUpdated = !(m.name in modVer && modVer[m.name]["version"] === m.version)

            if (!(isUpdated || isNew)) return arr;
            if (isNew && this._quick_install_mode) m.active = true

            return arr.concat([m]);
        }, []);
    }


    // Add a filter to the ModuleManagment page.
    data["filters"].push(
        {
            id: "recent",
            label: game.i18n.localize('QUICKMODMANAGE.FilterRecent'),
            css: this._filter === "recent" ? " active" : "",
            count: counts_recent
        },
        {
            id: "major",
            label: game.i18n.localize('QUICKMODMANAGE.FilterMajor') + "(< " + game.data.version.slice(0, -1) + "x)",
            css: this._filter === "major" ? " active" : "",
            count: counts_major
        },
        {
            id: "minor",
            label: game.i18n.localize('QUICKMODMANAGE.FilterMinor') + " (< " + game.data.version + ")",
            css: this._filter === "minor" ? " active" : "",
            count: counts_minor
        },
    )
    if (typeof ForgeVTT !== "undefined") {
        data.filters.push(
            {
                id: "error",
                label: game.i18n.localize('QUICKMODMANAGE.ManifestMismatch'),
                css: this._filter === "error" ? " active" : "",
                count: local_only.length + reinstall.length
            },
        )
    }

    return data
}

