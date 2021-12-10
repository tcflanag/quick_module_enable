Hooks.once("ready", quick_enable_init)

//CONFIG.debug.quick_module_enable =true

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

    const modVer = game.settings.get('quick-module-enable', 'previousModules')[0] // Element 0 is oldest, so check it for version
    const newMod = game.settings.get('quick-module-enable', 'previousModules').slice(-2)[0] // Second to last elemet is state at previous load

    for (var m of game.data.modules) {

        var isNew = !(m.data.name in newMod)
        var isUpdated = !(m.data.name in modVer && modVer[m.data.name]["version"] === m.data.version)
        if (isUpdated || isNew) {
            counts_recent++;
        }
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
    )

    return data
}

