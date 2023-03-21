
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
        onChange: () => { }
    });

    //Get current mod list
    var modVer = {}
    for (const mod of game.data.modules) {
        modVer[mod.id] = { version: mod.version??mod.data.version }
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
    if(typeof libWrapper === 'function') {
        libWrapper.register('quick-module-enable', 'ModuleManagement.prototype.getData',  function(wrapped, options) { return getQuickEnableData.call(this, wrapped(options))}, 'WRAPPER')
        libWrapper.register('quick-module-enable', 'ModuleManagement.prototype._onSearchFilter',  function(wrapped, event, query, rgx, html) { wrapped(event, query, rgx, html); return onSearchFilter.call(this, html )})
    }
    else {
        ModuleManagement.prototype.realGetData = ModuleManagement.prototype.getData
        ModuleManagement.prototype.getData = getQuickEnableData_so
        ModuleManagement.prototype._realOnSearchFilter = ModuleManagement.prototype._onSearchFilter
        ModuleManagement.prototype._onSearchFilter = realOnSearchFilter_so
    }

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


function getCompatVer(m_data) {
    return m_data?.compatibleCoreVersion ?? m_data?.compatibility?.verified ?? "X";
}

// New v9+ filters
function realOnSearchFilter_so(event, query, rgx, html) {
    this._realOnSearchFilter(event, query, rgx, html)
    onSearchFilter.call(this, html)
}
function onSearchFilter(html) {
    
    const version_string = game.version??game.data.version
    for ( let li of html.children ) {
        const name = li.dataset.moduleName??li.dataset.moduleId;
        const modVer = game.settings.get('quick-module-enable', 'previousModules')[0] // Element 0 is oldest, so check it for version
        const newMod = game.settings.get('quick-module-enable', 'previousModules').slice(-2)[0] // Second to last elemet is state at previous load

        var m_data = v10Compat()?game.modules.get(name):game.modules.get(name).data
        var vc = verCompare(version_string,getCompatVer(m_data))
        var isNew = !(name in newMod)
        var isUpdated = !(name in modVer && modVer[name]["version"] === m_data.version)

        if(((this._filter === "minor") && !vc.minor) ||
           ((this._filter === "major") && !vc.major ) ||
           ((this._filter === "recent") && !(isUpdated || isNew)) ||
            (( this._filter === "match") && (vc.minor || vc.major))
        ){
            li.classList.toggle("hidden", true);
           }
        
            // Filter the list when "recent" is chosen to just have new or updated
            // Pre-check the new mods if this is the startup display
           if (isNew && this._quick_install_mode) li.querySelectorAll('input[type=checkbox]')[0].checked = true
    }
  }


function getQuickEnableData_so(options){
    return getQuickEnableData.call(this, this.realGetData(options)) // Don't want to copy the bulk of this function for compatability.
}
function getQuickEnableData(data) {
    const version_string = game.version??game.data.version
    var counts_recent = 0
    var counts_major = 0
    var counts_minor = 0
    var counts_match = 0
    const modVer = game.settings.get('quick-module-enable', 'previousModules')[0] // Element 0 is oldest, so check it for version
    const newMod = game.settings.get('quick-module-enable', 'previousModules').slice(-2)[0] // Second to last elemet is state at previous load


    // Count loop is seperate from filter loop so that count is always correct
    // Othewise, since I'm using the output of the real GetData function (above), the count would change depending on those filters too
    for (var m of game.data.modules) {
        var m_data = v10Compat()?m:m.data
        var name = m_data?.name ?? m_data.id
        var isNew = !(name in newMod)
        var isUpdated = !(name in modVer && modVer[name]["version"] === m_data.version)
        if (isUpdated || isNew) {
            counts_recent++;
        }
        var vc= verCompare(version_string,getCompatVer(m_data))
        if (vc.major) counts_major++
        if (vc.minor) counts_minor++
        if (!vc.minor && !vc.major) counts_match++
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
            label: game.i18n.localize('QUICKMODMANAGE.FilterMajor') + "(< " + majorVersion(version_string) + ".x)",
            css: this._filter === "major" ? " active" : "",
            count: counts_major
        },
        {
            id: "minor",
            label: game.i18n.localize('QUICKMODMANAGE.FilterMinor') + " (< " + version_string + ")",
            css: this._filter === "minor" ? " active" : "",
            count: counts_minor
        },
        {
            id: "match",
            label: game.i18n.localize('QUICKMODMANAGE.FilterMatch') + " (>= " + version_string + ")",
            css: this._filter === "match" ? " active" : "",
            count: counts_match
        },
    )

    return data
}

function v10Compat(){
    const version_string = game.version??game.data.version
    return (isNewerVersion(version_string,'10')) 
}

function verCompare(ver0,ver1) {
    var major = isNewerVersion( majorVersion(ver0),majorVersion(ver1))
    var minor = isNewerVersion(ver0,ver1 ) && !major
    return {major, minor }
}

function majorVersion(version){
    if(!version || version === 'X'){
        return 0
    } 
    if (isNewerVersion('9',version)) {
        return version.split('.')[0] + "." + version.split('.')[1]
    } 
    return version.split('.')[0]

}

