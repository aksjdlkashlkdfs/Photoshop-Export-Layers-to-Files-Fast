// NAME: 
// 	Export Layers To Files

// DESCRIPTION: 
//  Improved version of the built-in "Export Layers To Files" script:
//  * Supports PNG and possibly other formats in the future.
//  * Does not create document duplicates, so it's much faster.
//	Saves each layer in the active document to a file in a preferred format named after the layer. Supported formats:
//  * PNG
//  * JPEG
//  * Targa

// REQUIRES: 
// 	Adobe Photoshop CS2 or higher

// Most current version always available at: https://github.com/skjorn/Photoshop-Export-Layers-as-Images

// enable double-clicking from Finder/Explorer (CS2 and higher)
#target photoshop
app.bringToFront();

bootstrap();

//
// Processing logic
//

function main()
{
    // user preferences
    prefs = new Object();
    prefs.fileType = "";
	try {
		prefs.filePath = app.activeDocument.path;
	}
	catch (e) {
		prefs.filePath = Folder.myDocuments;
	}
	prefs.formatArgs = null;
	prefs.visibleOnly = false;
	
	// create progress bar
	var progressBarWindow = createProgressBar();
	if (! progressBarWindow) {
		return "cancel";
	}
	
	// collect layers
	var profiler = new Profiler(env.profiling);
	var collected = collectLayers(activeDocument, progressBarWindow);
	layers = collected.layers;
	visibleLayers = collected.visibleLayers;
	var collectionDuration = profiler.getDuration(true, true);
	if (env.profiling) {
		alert("Layers collected in " + profiler.format(collectionDuration), "Debug info");
	}
	
    // show dialogue
	if (showDialog()) {
		// export
		profiler.resetLastTime();
	
		var count = exportLayers(activeDocument, prefs.visibleOnly, progressBarWindow);
		var exportDuration = profiler.getDuration(true, true);
		
		var message = "Saved " + count.count + " files.";
		if (env.profiling) {
			message += "\n\nExport function took " + profiler.format(collectionDuration) + " + " + profiler.format(exportDuration) + " to perform.";
		}
		if (count.error) {
			message += "\n\nSome layers were not exported! (Are there many layers with the same name?)"
		}
		alert(message, "Finished", count.error);
	}
	else {
		return "cancel";
	}
}

function exportLayers(doc, visibleOnly, progressBarWindow)
{
	var retVal = {
		count: 0,
		error: false
	};
	
	var layerCount = layers.length;
	
	if ((layerCount == 1) && layers[0].isBackgroundLayer) {
		// Flattened images don't support LayerComps or visibility toggling, so export it directly.
		if (saveImage(layers[0].name)) {
			++retVal.count;
		}
		else {
			retVal.error = true;
		}
	}
	else {	
		// capture current layer state
		var lastHistoryState = doc.activeHistoryState;
		var capturedState = doc.layerComps.add("ExportLayersToFilesTmp", "Temporary state for Export Layers To Files script", false, false, true);
		
		var layersToExport;
		if (visibleOnly) {
			layersToExport = [];
			for (var i = 0; i < layerCount; ++i) {
				if (layers[i].visible) {
					layersToExport.push(layers[i]);
				}
			}
		}
		else {
			layersToExport = layers;
		}
		
		var count = layersToExport.length;
		
		if (progressBarWindow) {
			showProgressBar(progressBarWindow, "Exporting 1 of " + count + "...", count);
		}
	
		// Turn off all layers when exporting all layers - even seemingly invisible ones.
		// When visibility is switched, the parent group becomes visible and a previously invisible child may become visible by accident.
		for (var i = 0; i < count; ++i) {
			layersToExport[i].visible = false;
		}
			
		// export layers
		for (var i = 0; i < count; ++i) {
			var layer = layersToExport[i];
			layer.visible = true;
			if (saveImage(layer.name)) {
				++retVal.count;
			}
			else {
				retVal.error = true;
			}
			layer.visible = false;
			
			if (progressBarWindow) {
				updateProgressBar(progressBarWindow, "Exporting " + (i + 1) + " of " + count + "...");
				repaintProgressBar(progressBarWindow);
			}
		}
				
		// restore layer state
		capturedState.apply();
		capturedState.remove();
		if (env.version <= 9) {
			doc.activeHistoryState = lastHistoryState;
			app.purge(PurgeTarget.HISTORYCACHES);
		}

		if (progressBarWindow) {
			progressBarWindow.hide();
		}
	}
		
	return retVal;
}

function saveImage(layerName) 
{
    var fileName = layerName.replace(/[\\\*\/\?:"\|<>]/g, ''); 
    fileName = fileName.replace(/[ ]/g, '_'); 
    if(fileName.length == 0) fileName = "Layer";
    var handle = getUniqueName(prefs.filePath + "/" + fileName);
	if (! handle) {
		return false;
	}
    
	if (prefs.formatArgs instanceof ExportOptionsSaveForWeb) {
		activeDocument.exportDocument(handle, ExportType.SAVEFORWEB, prefs.formatArgs);
	}
	else {
		activeDocument.saveAs(handle, prefs.formatArgs, true, Extension.LOWERCASE); 
	}
	
	return true;
}

function getUniqueName(fileroot) 
{ 
    // form a full file name
    // if the file name exists, a numeric suffix will be added to disambiguate
	
    var filename = fileroot;
	var ext = prefs.fileType.toLowerCase();
    for (var i=1; i<100; i++) {
        var handle = File(filename + "." + ext); 
        if(handle.exists) {
            filename = fileroot + "-" + padder(i, 3);
        } 
		else {
            return handle; 
        }
    }
	
	return false;
} 

function forEachLayer(inCollection, doFunc, result, traverseInvisibleSets)
{
	var length = inCollection.length;
	for (var i = 0; i < length; ++i) {
		var layer = inCollection[i];
		if (layer.typename == "LayerSet") {
			if (traverseInvisibleSets || layer.visible) {
				result = forEachLayer(layer.layers, doFunc, result, traverseInvisibleSets);
			}
		}
		else {
			result = doFunc(layer, result);
		}
	}
	
	return result;
}

// Indexed access to Layers via the default provided API is very slow, so all layers should be 
// collected into a separate collection beforehand and that should be accessed repeatedly.
function collectLayers(doc, progressBarWindow)
{
	if (progressBarWindow) {
		showProgressBar(progressBarWindow, "Collecting layers... Might take up to several seconds.", doc.layers.length);
	}
	
	var layers = forEachLayer(
		doc.layers,
		function(layer, result) 
		{
			result.layers.push(layer);			
			if (layer.visible) {
				result.visibleLayers.push(layer);
			}
			
			if (progressBarWindow && (layer.parent == doc)) {
				updateProgressBar(progressBarWindow);
				repaintProgressBar(progressBarWindow);
			}
			
			return result;
		},
		{
			layers: [],
			visibleLayers: []
		},
		true
	);
	
	if (progressBarWindow) {
		progressBarWindow.hide();
	}
	
	return layers;
}

//
// User interface
//

function createProgressBar()
{
 	// read progress bar resource
	var rsrcFile = new File(env.scriptFileDirectory + "/progress_bar.json");
	var rsrcString = loadResource(rsrcFile);
	if (! rsrcString) {
		return false;
	}

   // create window
	var win;
	try {
		win = new Window(rsrcString);
	}	
	catch (e) {
		alert("Progress bar resource is corrupt! Please, redownload the script with all files.", "Error", true);
		return false;
	}
	
	win.onClose = function() {
		return false;
	};
	
	return win;
}

function showProgressBar(win, message, maxValue)
{
	win.lblMessage.text = message;
	win.bar.maxvalue = maxValue;
	win.bar.value = 0;
	
	win.center();
	win.show();
	repaintProgressBar(win, true);
}

function updateProgressBar(win, message)
{
	++win.bar.value;
	if (message) {
		win.lblMessage.text = message;
	}
}

function repaintProgressBar(win, force /* = false*/) 
{
	if (env.version >= 11) {	// CS4 added support for UI updates; the previous method became unbearably slow, as is app.refresh()
		if (force) {
			app.refresh();
		}
		else {  
			win.update();
		}
	}
	else {	
		// CS3 and below
		var d = new ActionDescriptor();
		d.putEnumerated(app.stringIDToTypeID('state'), app.stringIDToTypeID('state'), app.stringIDToTypeID('redrawComplete'));
		executeAction(app.stringIDToTypeID('wait'), d, DialogModes.NO);
  }
}

function showDialog() 
{
 	// read dialog resource
	var rsrcFile = new File(env.scriptFileDirectory + "/dialog.json");
	var rsrcString = loadResource(rsrcFile);
	if (! rsrcString) {
		return false;
	}

   // build dialogue
	var dlg;
	try {
		dlg = new Window(rsrcString);
	}	
	catch (e) {
		alert("Dialog resource is corrupt! Please, redownload the script with all files.", "Error", true);
		return false;
	}
	
	// destination path
	dlg.funcArea.content.grpDest.txtDest.text = prefs.filePath.fsName;
	dlg.funcArea.content.grpDest.btnDest.onClick = function() {
		var newFilePath = Folder.selectDialog("Select destination folder", prefs.filePath);
		if (newFilePath) {
			prefs.filePath = newFilePath;
			dlg.funcArea.content.grpDest.txtDest.text = newFilePath.fsName;
		}
	}
	
	// layer subset selection
	dlg.funcArea.content.grpLayers.radioLayersAll.onClick = function() {
		prefs.visibleOnly = false;
	}
	dlg.funcArea.content.grpLayers.radioLayersVis.onClick = function() {
		prefs.visibleOnly = true;
	}
	
	var formatDropDown = dlg.funcArea.content.grpFileType.drdFileType;
	var optionsPanel = dlg.funcArea.content.pnlOptions;

    // file type - call cloned getDialogParams*() for new file formats here
	// (add a single line, the rest is taken care of)
    var saveOpt = [];
	var paramFuncs = [getDialogParamsPNG, getDialogParamsJPEG, getDialogParamsTarga];
    for (var i = 0, len = paramFuncs.length; i < len; ++i) {
		var optionsRoot = optionsPanel.add("group");
		optionsRoot.orientation = "column";
		optionsRoot.alignChildren = "left";
		var opts = paramFuncs[i](optionsRoot);
		opts.controlRoot = optionsRoot;
		saveOpt.push(opts);
		
        formatDropDown.add("item", saveOpt[i].type);
    }
	
    // show proper file type options
    formatDropDown.onChange = function() {
		// Note: There's a bug in CS5 and CC where ListItem.selected doesn't report correct value in onChange().
		// A workaround is to rely on DropDownList.selection instead.
		for (var i = saveOpt.length - 1; i >= 0; --i) {
			saveOpt[i].controlRoot.hide();
		}
		saveOpt[this.selection.index].controlRoot.show();
    }; 
	
    formatDropDown.selection = 0;
	  	   
    // buttons
    dlg.funcArea.buttons.btnRun.onClick = function() {
		// collect arguments for saving and proceed
		var selIdx = formatDropDown.selection.index;
		saveOpt[selIdx].handler(saveOpt[selIdx].controlRoot);
        dlg.close(1); 
    }; 
    dlg.funcArea.buttons.btnCancel.onClick = function() {
        dlg.close(0); 
    }; 
	
	// warning message
	dlg.warning.message.text = formatString(dlg.warning.message.text, layers.length, visibleLayers.length);

	dlg.center(); 
    return dlg.show();
}

// Clone these two functions to add a new export file format - GUI
function getDialogParamsTarga(parent)
{
	var depth = parent.add("group");
	depth.add("statictext", undefined, "Depth:");
	var bitsPerPixelLabels = ["16 bit", "24 bit", "32 bit"];
	parent.bitsPerPixel = depth.add("dropdownlist", undefined, bitsPerPixelLabels);
	parent.bitsPerPixel.selection = 2;
	
	parent.alpha = parent.add("checkbox", undefined, "With alpha channel");
	parent.alpha.value = true;
		
	parent.rle = parent.add("checkbox", undefined, "RLE compression");
	parent.rle.value = true;
	
	return {type: "TGA", handler: onDialogSelectTarga};
}

// Clone these two functions to add a new export file format - result handler
function onDialogSelectTarga(controlRoot)
{
	prefs.fileType = "TGA";
	prefs.formatArgs = new TargaSaveOptions();
	prefs.formatArgs.alphaChannels = controlRoot.alpha.value;
	prefs.formatArgs.rleCompression = controlRoot.rle.value;
	var resolution_enum = [TargaBitsPerPixels.SIXTEEN, TargaBitsPerPixels.TWENTYFOUR, TargaBitsPerPixels.THIRTYTWO];
	prefs.formatArgs.resolution = resolution_enum[controlRoot.bitsPerPixel.selection.index];
}

function getDialogParamsJPEG(parent)
{
	var qualityRow = parent.add("group");
	qualityRow.add("statictext", undefined, "Quality:");
	parent.quality = qualityRow.add("dropdownlist");
	
    for (var i=12; i>=1; --i) {
		parent.quality.add('item', "" + i);
    }
	
	parent.quality.selection = 0;
	
	return {type: "JPG", handler: onDialogSelectJPEG};
}

function onDialogSelectJPEG(controlRoot)
{
	prefs.fileType = "JPG";
	prefs.formatArgs = new JPEGSaveOptions();
	prefs.formatArgs.quality = 12 - controlRoot.quality.selection.index;
}

function getDialogParamsPNG(parent)
{
	var type = parent.add("group");
	type.add("statictext", undefined, "Resolution:");
	var resolution_items = ["8 bit", "24 bit"];
	parent.resolution = type.add("dropdownlist", undefined, resolution_items);	
	parent.resolution.selection = 1;
	
	return {type: "PNG", handler: onDialogSelectPNG};
}

function onDialogSelectPNG(controlRoot)
{
	prefs.fileType = "PNG";
	prefs.formatArgs = new ExportOptionsSaveForWeb();
	prefs.formatArgs.format = SaveDocumentType.PNG;
	prefs.formatArgs.PNG8 = controlRoot.resolution.items[0].selected;
	prefs.formatArgs.dither = Dither.NONE;
}

//
// Bootstrapper (version support, getting additional environment settings, error handling...)
//

function bootstrap() 
{
    function showError(err) {
        alert(err + ': on line ' + err.line, 'Script Error', true);
    }

	// initialisation of class methods
	defineProfilerMethods();
	
	// check if there's a document open
	try {
		var doc = activeDocument;		// this actually triggers the exception
		if (! doc) {					// this is just for sure if it ever behaves differently in other versions
			throw new Error();
		}
	}
	catch (e) {
		alert("No document is open! Nothing to export.", "Error", true);
		return "cancel";
	}
	
    try {
		// setup the environment
		
		env = new Object();
		
		env.profiling = false;
		
		env.version = parseInt(version, 10);
		
		if (env.version < 9) {
			alert("Photoshop versions before CS2 are not supported!", "Error", true);
			return "cancel";
		}
		
		env.cs3OrHigher = (env.version >= 10);
		
		// get script's file name
		if (env.cs3OrHigher) {
			env.scriptFileName = $.fileName;
		}
		else {
			try {
				//throw new Error();		// doesn't provide the file name, at least in CS2
				var illegal = RUNTIME_ERROR;
			}
			catch (e) {
				env.scriptFileName = e.fileName;
			}
		}
		
		env.scriptFileDirectory = (new File(env.scriptFileName)).parent;
		
		// run the script itself
        if (env.cs3OrHigher) {
			// suspend history for CS3 or higher
            activeDocument.suspendHistory('Export Layers To Files', 'main()');
        } 
		else {
            main();
        }
    } 
	catch(e) {
        // report errors unless the user cancelled
        if (e.number != 8007) showError(e);
		return "cancel";
    }
}

//
// Utilities
//

function padder(input, padLength) 
{
    // pad the input with zeroes up to indicated length
    var result = (new Array(padLength + 1 - input.toString().length)).join('0') + input;
    return result;
}

function formatString(text) 
{
	var args = Array.prototype.slice.call(arguments, 1);
	return text.replace(/\{(\d+)\}/g, function(match, number) { 
			return (typeof args[number] != 'undefined') ? args[number] : match;
		});
}

function loadResource(file)
{
	var rsrcString;
	if (! file.exists) {
		alert("Resource file '" + file.name + "' for the export dialog is missing! Please, download the rest of the files that come with this script.", "Error", true);
		return false;
	}
	try {
		file.open("r");
		if (file.error) throw file.error;
		rsrcString = file.read();
		if (file.error) throw file.error;
		if (! file.close()) {
			throw file.error;
		}
	}
	catch (error) {
		alert("Failed to read the resource file '" + rsrcFile + "'!\n\nReason: " + error + "\n\nPlease, check it's available for reading and redownload it in case it became corrupted.", "Error", true);
		return false;
	}
	
	return rsrcString;
}

function Profiler(enabled)
{
	this.enabled = enabled;
	if (this.enabled) {
		this.startTime = new Date();
		this.lastTime = this.startTime;
	}
}

function defineProfilerMethods()
{
	Profiler.prototype.getDuration = function(rememberAsLastCall, sinceLastCall)
	{
		if (this.enabled) {
			var currentTime = new Date();
			var lastTime = sinceLastCall ? this.lastTime : this.startTime;
			if (rememberAsLastCall) {
				this.lastTime = currentTime;
			}
			return new Date(currentTime.getTime() - lastTime.getTime());
		}
	}
	
	Profiler.prototype.resetLastTime = function()
	{
		this.lastTime = new Date();
	}

	Profiler.prototype.format = function(duration)
	{
		var output = padder(duration.getUTCHours(), 2) + ":";
		output += padder(duration.getUTCMinutes(), 2) + ":";
		output += padder(duration.getUTCSeconds(), 2) + ".";
		output += padder(duration.getUTCMilliseconds(), 3);
		return output;
	}
}
