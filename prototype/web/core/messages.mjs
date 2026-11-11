// Stable, locale-independent descriptors keep imported evidence separate from UI language.
// English is the fallback for every caller; the presentation layer supplies its locale.
const catalog = {
  "coverage.hardware": { "en": "PnP device identities", "de": "PnP-Gerätekennungen" },
  "coverage.bindings": { "en": "Reported device-to-INF bindings", "de": "Gemeldete Geräte-INF-Zuordnung" },
  "coverage.store": { "en": "Driver-store packages", "de": "Pakete im Treiberspeicher" },
  "coverage.wlan": { "en": "WLAN radio report", "de": "WLAN-Adapterbericht" },
  "coverage.bluetooth": { "en": "Bluetooth radio report", "de": "Bluetooth-Adapterbericht" },
  "coverage.inventoryRows": {
    "en": "{read} records recognized; {skipped} lines unresolved. Presence and driver binding are assessed separately.",
    "de": "{read} Einträge erkannt; {skipped} Zeilen ungeklärt. Präsenz und Treiberzuordnung werden getrennt bewertet."
  },
  "zip.legacyNames": {
    "en": "ZIP filenames with legacy character encodings are not supported yet.",
    "de": "ZIP-Dateinamen mit älterer Zeichenkodierung werden noch nicht unterstützt."
  },
  "zip.unsafePath": {
    "en": "The ZIP contains an invalid or unsafe file path.",
    "de": "Das ZIP enthält einen ungültigen oder unsicheren Dateipfad."
  },
  "zip.unreadable": {
    "en": "No readable ZIP file.",
    "de": "Keine lesbare ZIP-Datei."
  },
  "zip.archiveLimit": {
    "en": "The ZIP exceeds the prototype limit of 512 MiB.",
    "de": "Das ZIP ist größer als das Prototyp-Limit von 512 MiB."
  },
  "zip.incompleteArchive": {
    "en": "The file is not a complete ZIP archive.",
    "de": "Die Datei ist kein vollständiges ZIP."
  },
  "zip.noDirectory": {
    "en": "ZIP directory not found.",
    "de": "ZIP-Inhaltsverzeichnis nicht gefunden."
  },
  "zip.zip64": {
    "en": "ZIP64 is not supported in this prototype.",
    "de": "ZIP64 wird im Prototyp noch nicht unterstützt."
  },
  "zip.multipart": {
    "en": "Multipart ZIP archives are not supported.",
    "de": "Mehrteilige ZIP-Archive werden nicht unterstützt."
  },
  "zip.directoryLimit": {
    "en": "Invalid or oversized ZIP directory.",
    "de": "Ungültiges oder zu großes ZIP-Inhaltsverzeichnis."
  },
  "zip.corruptDirectory": {
    "en": "Damaged ZIP directory.",
    "de": "Beschädigtes ZIP-Inhaltsverzeichnis."
  },
  "zip.invalidEntry": {
    "en": "Invalid ZIP entry or unsupported ZIP64.",
    "de": "Ungültiger ZIP-Dateieintrag oder nicht unterstütztes ZIP64."
  },
  "zip.encrypted": {
    "en": "Encrypted ZIP archives are not supported.",
    "de": "Verschlüsselte ZIP-Archive werden nicht unterstützt."
  },
  "zip.duplicatePath": {
    "en": "Ambiguous duplicate file paths in the ZIP.",
    "de": "Mehrdeutige, doppelte Dateipfade im ZIP."
  },
  "zip.expandedLimit": {
    "en": "Expanded content exceeds the prototype limit of 2 GiB.",
    "de": "Entpackter Umfang überschreitet das Prototyp-Limit von 2 GiB."
  },
  "zip.unexpectedDirectory": {
    "en": "Unexpected data in the ZIP directory.",
    "de": "Unerwartete Daten im ZIP-Inhaltsverzeichnis."
  },
  "zip.missingEntry": {
    "en": "ZIP file entry not found.",
    "de": "ZIP-Dateieintrag nicht vorhanden."
  },
  "zip.readLimit": {
    "en": "The source file exceeds the read limit.",
    "de": "Quelldatei überschreitet das Leselimit."
  },
  "zip.compression": {
    "en": "This ZIP compression method is not supported yet.",
    "de": "Diese ZIP-Kompression wird noch nicht unterstützt."
  },
  "zip.headerMismatch": {
    "en": "The ZIP file header does not match the directory.",
    "de": "ZIP-Dateikopf stimmt nicht mit dem Verzeichnis überein."
  },
  "zip.dataRange": {
    "en": "ZIP file data is outside the allowed range.",
    "de": "ZIP-Dateidaten außerhalb des erlaubten Bereichs."
  },
  "zip.nameMismatch": {
    "en": "Conflicting filenames in the ZIP.",
    "de": "Widersprüchliche Dateinamen im ZIP."
  },
  "zip.browserSupport": {
    "en": "This browser does not support the required ZIP decompression. Please use a current Edge, Chrome or Firefox browser.",
    "de": "Dieser Browser unterstützt die benötigte ZIP-Dekompression noch nicht. Bitte einen aktuellen Edge, Chrome oder Firefox verwenden."
  },
  "zip.sizeMismatch": {
    "en": "The ZIP entry exceeds its declared size.",
    "de": "ZIP-Datei überschreitet ihre angegebene Größe."
  },
  "zip.incompleteEntry": {
    "en": "The ZIP entry is incomplete.",
    "de": "ZIP-Datei ist unvollständig."
  },
  "zip.checksum": {
    "en": "ZIP checksum mismatch: the source file is damaged.",
    "de": "ZIP-Prüfsumme stimmt nicht: Die Quelldatei ist beschädigt."
  },
  "cdat.encoding": {
    "en": "Text encoding cannot be read reliably; no character encoding is assumed automatically.",
    "de": "Textkodierung nicht eindeutig lesbar; keine automatische Zeichensatz-Vermutung."
  },
  "cdat.multipleSources": {
    "en": "Multiple sources for {label} in the archive. Please use a single CDAT capture.",
    "de": "Mehrere Quellen für {label} im Archiv. Bitte eine einzelne CDAT-Aufnahme verwenden."
  },
  "cdat.unsupported": {
    "en": "No supported CDAT capture found (FileDetails.json or QuickData is missing).",
    "de": "Keine unterstützte CDAT-Aufnahme gefunden (FileDetails.json oder QuickData fehlt)."
  },
  "cdat.mixedRoots": {
    "en": "The sources are in different capture folders. Open each CDAT capture as a separate ZIP.",
    "de": "Die Quellen liegen in verschiedenen Aufnahmeordnern. Bitte jede CDAT-Aufnahme als eigenes ZIP öffnen."
  },
  "cdat.emptySource": {
    "en": "The source file is empty.",
    "de": "Quelldatei ist leer."
  },
  "cdat.manifestStructure": {
    "en": "Unknown structure in FileDetails.json.",
    "de": "Unbekannte Struktur in FileDetails.json."
  },
  "cdat.noDeviceData": {
    "en": "The CDAT sources contain no usable device data.",
    "de": "Die CDAT-Quellen liefern keine auswertbaren Gerätedaten."
  },
  "coverage.manifest": {
    "en": "CDAT file index",
    "de": "CDAT-Dateiverzeichnis"
  },
  "coverage.quick": {
    "en": "Device overview",
    "de": "Geräteübersicht"
  },
  "coverage.computer": {
    "en": "System information",
    "de": "Systeminformationen"
  },
  "coverage.drivers": {
    "en": "Reported device drivers",
    "de": "Gemeldete Gerätetreiber"
  },
  "coverage.issues": {
    "en": "Collection notices",
    "de": "Erfassungshinweise"
  },
  "coverage.missing": {
    "en": "Source file missing; state not determined.",
    "de": "Quelldatei fehlt; Zustand nicht ermittelt."
  },
  "coverage.read": {
    "en": "Source file read; completeness has not been established.",
    "de": "Quelldatei gelesen; kein Vollständigkeitsnachweis."
  },
  "coverage.invalidJson": {
    "en": "JSON structure could not be interpreted.",
    "de": "JSON-Struktur nicht auswertbar."
  },
  "coverage.driverRows": {
    "en": "{read} rows recognized; {skipped} could not be read reliably.",
    "de": "{read} Zeilen erkannt; {skipped} nicht eindeutig lesbar."
  },
  "coverage.collectionFailure": {
    "en": "File read; CDAT reports at least one failed query.",
    "de": "Datei gelesen; CDAT meldet mindestens eine fehlgeschlagene Abfrage."
  },
  "warning.sourceFailure": {
    "en": "{label}: {detail}",
    "de": "{label}: {detail}"
  },
  "warning.manifest": {
    "en": "FileDetails.json could not be interpreted as a CDAT file index.",
    "de": "FileDetails.json ist nicht als CDAT-Verzeichnis auswertbar."
  },
  "warning.conflict": {
    "en": "Conflicting values for {field}; the preferred source is shown.",
    "de": "Abweichende Angaben für {field}; die bevorzugte Quelle wird angezeigt."
  },
  "warning.driverTable": {
    "en": "The device driver table could only be read partially or not at all.",
    "de": "Die Gerätetreibertabelle konnte nur teilweise oder nicht gelesen werden."
  },
  "warning.collection": {
    "en": "Failed CDAT query: {error}",
    "de": "Fehlgeschlagene CDAT-Abfrage: {error}"
  },
  "lenovo.invalidUrl": {
    "en": "Invalid Lenovo source address.",
    "de": "Ungültige Lenovo-Quelladresse."
  },
  "lenovo.forbiddenUrl": {
    "en": "This source is not allowed for Lenovo requests.",
    "de": "Diese Quelle ist für den Lenovo-Abruf nicht freigegeben."
  },
  "lenovo.invalidPath": {
    "en": "Invalid path in the Lenovo source address.",
    "de": "Ungültiger Pfad in der Lenovo-Quelladresse."
  },
  "lenovo.responseLimit": {
    "en": "The Lenovo response exceeds the size limit.",
    "de": "Die Lenovo-Antwort überschreitet das Größenlimit."
  },
  "lenovo.responseFormat": {
    "en": "The local Lenovo service returned an unexpected format (HTTP {status}).",
    "de": "Der lokale Lenovo-Dienst antwortet nicht im erwarteten Format (HTTP {status})."
  },
  "lenovo.requestFailed": {
    "en": "Lenovo request failed: {detail}",
    "de": "Lenovo-Abruf fehlgeschlagen: {detail}"
  },
  "lenovo.incompleteMetadata": {
    "en": "The local Lenovo service returned incomplete metadata.",
    "de": "Der lokale Lenovo-Dienst hat unvollständige Metadaten geliefert."
  },
  "lenovo.timeout": {
    "en": "The Lenovo request timed out. Please check the network or proxy.",
    "de": "Zeitüberschreitung beim Lenovo-Abruf. Bitte Netzwerk oder Proxy prüfen."
  },
  "lenovo.unreachable": {
    "en": "The local Lenovo service cannot be reached. Please check the LORE launcher.",
    "de": "Der lokale Lenovo-Dienst ist nicht erreichbar. Bitte den LORE-Starter prüfen."
  },
  "lenovo.xmlSupport": {
    "en": "This browser does not support XML parsing.",
    "de": "Dieser Browser unterstützt die XML-Auswertung nicht."
  },
  "lenovo.xmlDeclaration": {
    "en": "The Lenovo XML file contains an unsupported document declaration.",
    "de": "Die Lenovo-XML-Datei enthält eine nicht unterstützte Dokumentdeklaration."
  },
  "lenovo.invalidXml": {
    "en": "The Lenovo response is not a valid {root} XML file.",
    "de": "Die Lenovo-Antwort ist keine gültige {root}-XML-Datei."
  },
  "lenovo.catalogLimit": {
    "en": "The Lenovo catalog contains too many entries.",
    "de": "Der Lenovo-Katalog enthält zu viele Einträge."
  },
  "lenovo.invalidPackage": {
    "en": "The Lenovo catalog refers to an invalid package file.",
    "de": "Der Lenovo-Katalog verweist auf eine ungültige Paketdatei."
  },
  "lenovo.machineType": {
    "en": "Please enter the four-character machine type, for example 21MM.",
    "de": "Bitte den vierstelligen Machine Type eingeben, zum Beispiel 21MM."
  },
  "lenovo.os": {
    "en": "Please select Windows 10 or Windows 11.",
    "de": "Bitte Windows 10 oder Windows 11 wählen."
  },
  "lenovo.packageXml": {
    "en": "Package details require a Lenovo package XML file.",
    "de": "Für Paketdetails wird eine Lenovo-Paket-XML-Datei benötigt."
  },
  "lenovo.readmeSupport": {
    "en": "This browser does not support readme parsing.",
    "de": "Dieser Browser unterstützt die Readme-Auswertung nicht."
  },
  "lenovo.readmeType": {
    "en": "Only Lenovo text and HTML files are allowed for readmes.",
    "de": "Für Readmes sind nur Lenovo-Text- und HTML-Dateien erlaubt."
  },
  "lenovo.noteReadme": {
    "en": "The readme reference has an unsupported format.",
    "de": "Der Readme-Verweis hat ein nicht unterstütztes Format."
  },
  "lenovo.noteRules": {
    "en": "The package contains applicability rules. These have not been evaluated in this prototype.",
    "de": "Das Paket enthält Anwendbarkeitsregeln. Diese wurden im Prototyp nicht ausgewertet."
  },
  "lenovo.noteVersion": {
    "en": "Package version from the Lenovo catalog; this does not establish that it is current or applicable to this device.",
    "de": "Paketversion aus dem Lenovo-Katalog; kein Nachweis für Aktualität oder Anwendbarkeit auf dieses Gerät."
  },
  "lenovo.noCategory": {
    "en": "Uncategorized",
    "de": "Ohne Kategorie"
  },
  "lenovo.packageTitle": {
    "en": "Lenovo package",
    "de": "Lenovo-Paket"
  }
};

export function message(key, params = {}) { return { key, params }; }

export function formatMessage(value, locale = 'en') {
  if (value == null) return '';
  if (typeof value === 'number') return new Intl.NumberFormat(locale === 'de' ? 'de-DE' : 'en-US').format(value);
  if (typeof value !== 'object') return String(value);
  const descriptor = value.messageDescriptor || value;
  if (typeof descriptor.key !== 'string' || !Object.hasOwn(catalog, descriptor.key)) {
    return typeof value.message === 'string' ? value.message : '';
  }
  const template = catalog[descriptor.key][locale === 'de' ? 'de' : 'en'];
  return template.replace(/\{([a-zA-Z][a-zA-Z0-9]*)\}/g, (match, name) =>
    Object.hasOwn(descriptor.params || {}, name) ? formatMessage(descriptor.params[name], locale) : match);
}

export function messageError(key, params = {}) {
  const descriptor = message(key, params);
  const error = new Error(formatMessage(descriptor));
  error.code = key;
  error.messageDescriptor = descriptor;
  return error;
}
