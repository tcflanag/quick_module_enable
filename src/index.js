
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
    //modHistory =  [{"quick-module-enable":{"version":"1.4.0"}}]
    // Initialize history if empty
    if (modHistory.length === 0) modHistory.push(modVer)
    while (modHistory.length <= history_size) modHistory.unshift(modHistory[0])
    while (modHistory.length > history_size) modHistory.shift()

    // Update history
    modHistory.shift() // Delete the oldest data
    modHistory.push(modVer) // Add this runs data to the stack
    await game.settings.set('quick-module-enable', 'previousModules', modHistory)

    // Monkeypatch to reuse the existing Modmanagment API
    if (typeof libWrapper === 'function') {
        libWrapper.register('quick-module-enable', 'ModuleManagement.prototype.getData', function (wrapped, options) {
            return getQuickEnableData.call(this, wrapped(options))
        }, 'WRAPPER')
        libWrapper.register('quick-module-enable', 'ModuleManagement.prototype._onSearchFilter', function (wrapped, event, query, rgx, html) {
            wrapped(event, query, rgx, html);
            return onSearchFilter.call(this, html)
        })
    }
    else if (!v13Compat()) {
        ModuleManagement.prototype.realGetData = ModuleManagement.prototype.getData
        ModuleManagement.prototype.getData = getQuickEnableData_so
        ModuleManagement.prototype._realOnSearchFilter = ModuleManagement.prototype._onSearchFilter
        ModuleManagement.prototype._onSearchFilter = realOnSearchFilter_so
    }
    else {
        //ModuleManagement.prototype.realGetData = ModuleManagement.prototype.getData
        //ModuleManagement.prototype.getData = getQuickEnableData_so
        foundry.applications.sidebar.apps.ModuleManagement.prototype._realPrepareContext = foundry.applications.sidebar.apps.ModuleManagement.prototype._prepareContext
        foundry.applications.sidebar.apps.ModuleManagement.prototype._prepareContext = getQuickEnableData


        foundry.applications.sidebar.apps.ModuleManagement.prototype._realOnSearchFilter =  foundry.applications.sidebar.apps.ModuleManagement.DEFAULT_OPTIONS["actions"]["changeFilter"]
        foundry.applications.sidebar.apps.ModuleManagement.DEFAULT_OPTIONS["actions"]["changeFilter"]=onChangeFilter
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
        var b = new foundry.applications.sidebar.apps.ModuleManagement();
        b._filter = "recent"  // Default the dissplay to the "Recent" tb
        b._quick_install_mode = true // Auto enable new mods
        var temp = foundry.applications.sidebar.apps.ModuleManagement.prototype._onRender
        foundry.applications.sidebar.apps.ModuleManagement.prototype._onRender = function (){console.log("AAAAA")}
        await b.render(true);
        foundry.applications.sidebar.apps.ModuleManagement.prototype._onRender = temp
    }
}


function getCompatVer(m_data) {
    return m_data?.compatibleCoreVersion ?? m_data?.compatibility?.verified ?? "X";
}

// New v9+ filters
// function realOnSearchFilter_so(event, query, rgx, html) {
//
//     onSearchFilter.call(this, html)
// }
function onChangeFilter(_event, target) {


    this._filter = target.dataset.filter;


    const version_string = game.version??game.data.version
    for ( let li of this.element.querySelectorAll(".package" )) {
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
        else{
            li.classList.toggle("hidden", false);
        }
        
            // Filter the list when "recent" is chosen to just have new or updated
            // Pre-check the new mods if this is the startup display
           if (isNew && this._quick_install_mode) li.querySelectorAll('input[type=checkbox]')[0].checked = true
    }

    this._realOnSearchFilter(_event, target)

  }

async function _onRender_so(context, options) {
    if (!this._quick_install_mode) {
        this._realOnRender(context, options)
    }

}

function test() {
    // foundry.applications.sidebar.apps.ModuleManagement.prototype._realOnRender = foundry.applications.sidebar.apps.ModuleManagement.prototype._onRender
    // foundry.applications.sidebar.apps.ModuleManagement.prototype._onRender = _onRender_so

}

async function getQuickEnableData(options) {

    context = await this._realPrepareContext(options)
    const version_string = game.version??game.data.version
    var counts_recent = 0
    var counts_major = 0
    var counts_minor = 0
    var counts_match = 0
    const modVer = game.settings.get('quick-module-enable', 'previousModules')[0] // Element 0 is oldest, so check it for version
    const newMod = game.settings.get('quick-module-enable', 'previousModules').slice(-2)[0] // Second to last elemet is state at previous load


    // Count loop is seperate from filter loop so that count is always correct
    // Othewise, since I'm using the output of the real GetData function (above), the count would change depending on those filters too
    for (var m of context.modules) {
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

        if (this._quick_install_mode) {
            if (isNew ){
                m_data.active = true
                m_data.hidden = false
            }
            else {
                m_data.hidden = true
            }
        }


    }


    // Add a filter to the ModuleManagment page.
    context["filters"].push(
        {
            id: "recent",
            label: game.i18n.localize('QUICKMODMANAGE.FilterRecent'),
            active: this._quick_install_mode,
            count: counts_recent
        },
        {
            id: "major",
            label: game.i18n.localize('QUICKMODMANAGE.FilterMajor') + "(< " + majorVersion(version_string) + ".x)",
            count: counts_major
        },
        {
            id: "minor",
            label: game.i18n.localize('QUICKMODMANAGE.FilterMinor') + " (< " + version_string + ")",
            count: counts_minor
        },
        {
            id: "match",
            label: game.i18n.localize('QUICKMODMANAGE.FilterMatch') + " (>= " + version_string + ")",
            count: counts_match
        },
    )
    if (this._quick_install_mode) {
        context["filters"][0].active = false
    }

    return context
}

function v10Compat(){
    const version_string = game.version??game.data.version
    return (foundry.utils.isNewerVersion(version_string,'10'))
}

function v13Compat(){
    const version_string = game.version??game.data.version
    return (foundry.utils.isNewerVersion(version_string,'13'))
}

function verCompare(ver0,ver1) {
    var major = foundry.utils.isNewerVersion( majorVersion(ver0),majorVersion(ver1))
    var minor = foundry.utils.isNewerVersion(ver0,ver1 ) && !major
    return {major, minor }
}

function majorVersion(version){
    if(!version || version === 'X'){
        return 0
    } 
    if (foundry.utils.isNewerVersion('9',version)) {
        return version.split('.')[0] + "." + version.split('.')[1]
    } 
    return version.split('.')[0]

}

