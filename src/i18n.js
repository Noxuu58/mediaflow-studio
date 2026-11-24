// Translations. English is the default; the choice is stored in localStorage ('lang').
// A value is a string with {placeholders} or a function of the vars (for plurals).
// To add a language: copy the `en` block, translate it, and add its name to LANGS.
const I18n = (() => {
  const s = (n) => (n > 1 ? 's' : '');
  const dict = {
    en: {
      'app.tools': 'Tools', 'app.collapse': 'Collapse', 'app.collapseTip': 'Collapse sidebar',
      'app.sounds': 'Sounds', 'app.soundsTip': 'Interface sounds', 'app.langTip': 'Language',
      'app.langBusy': 'Finish running jobs before switching language',
      'drop.title': 'Release to add', 'drop.sub': 'Files or links',
      'unit.kb': 'KB', 'unit.mb': 'MB', 'unit.gb': 'GB',
      'kind.image': 'Images', 'kind.audio': 'Audio', 'kind.video': 'Video',
      'spec.fps': 'fps', 'spec.stereo': 'stereo', 'spec.mono': 'mono', 'spec.pcm': 'PCM {bits}-bit',
      'common.browse': 'or click to browse', 'common.retry': 'Retry', 'common.cancel': 'Cancel', 'common.esc': 'Esc',
      'common.reveal': 'Show in Explorer', 'common.left': '{t} left', 'common.estimating': 'Estimating…',
      'common.outputSource': 'Same folder as source', 'common.outputTip': 'Output folder', 'common.outputReset': 'Back to the source folder',

      'q.queue': 'Queue', 'q.files': ({ n }) => `${n} file${s(n)}`, 'q.add': 'Add', 'q.cleanDone': 'Remove finished', 'q.clear': 'Clear all',
      'q.allTo': 'All to', 'q.ready': 'Ready', 'q.queued': 'Queued', 'q.cancelled': 'Cancelled', 'q.failed': 'Failed', 'q.done': 'Done',
      'q.starting': 'Starting…', 'q.remove': 'Remove from queue', 'q.outFmt': 'Output format for {name}',
      'q.overall': ({ i, n, left }) => `File ${i} of ${n}${left ? ` · about ${left} left` : ''}`,
      'q.took': '→ {name} · in {time}',
      'q.skipped': ({ n }) => `${n} item${s(n)} skipped: unsupported format`,
      'q.cancelledToast': 'Queue cancelled',
      'q.result': ({ ok, ko }) => (ko ? `${ok} done, ${ko} failed` : `${ok} file${s(ok)} done`),

      'conv.label': 'Converter', 'conv.subtitle': 'Images, audio and video — maximum quality, lossless remux when possible',
      'conv.hero': 'Drop your media here', 'conv.go': ({ n }) => (n > 1 ? `Convert ${n} files` : 'Convert'), 'conv.notify': 'Conversion complete',

      'ext.label': 'Audio Extractor', 'ext.subtitle': 'Clean audio out of any video — loudness normalization and cleanup built in',
      'ext.hero': 'Drop videos to extract their audio', 'ext.go': ({ n }) => (n > 1 ? `Extract ${n} files` : 'Extract'), 'ext.notify': 'Extraction complete',
      'ext.in': 'From', 'ext.out': 'To', 'ext.clean': 'Cleanup', 'ext.cleanList': 'Loudness · Noise · Low-cut',
      'ext.loudness': 'Loudness', 'ext.loud.off': 'Original level', 'ext.loud.14': 'Streaming · −14 LUFS',
      'ext.loud.16': 'Podcast · −16 LUFS', 'ext.loud.23': 'Broadcast · −23 LUFS',
      'ext.denoise': 'Reduce noise', 'ext.lowcut': 'Low-cut 80 Hz',

      'trim.label': 'Trimmer', 'trim.subtitle': 'Cut clips in seconds — lossless stream copy, no re-encoding',
      'trim.empty': 'Drop a video to trim', 'trim.emptySub': 'Space plays · I and O set the in and out points',
      'trim.in': 'In', 'trim.out': 'Out', 'trim.length': 'Clip',
      'trim.setIn': 'Set in point (I)', 'trim.setOut': 'Set out point (O)', 'trim.play': 'Play / pause (Space)',
      'trim.fast': 'Fast · lossless', 'trim.precise': 'Frame-accurate',
      'trim.modeTip': 'Fast copies the streams without re-encoding: instant and lossless, the clip starts on the nearest keyframe. Frame-accurate re-encodes at maximum quality.',
      'trim.export': 'Export clip', 'trim.open': 'Open another', 'trim.exporting': 'Exporting {name}…',
      'trim.saved': 'Clip saved: {name}', 'trim.notify': 'Clip exported', 'trim.showLast': 'Show last clip',
      'trim.noPreview': 'No preview for this codec — the timeline and export still work',
      'trim.unsupported': 'Pick a video or audio file',

      'dl.label': 'Downloader', 'dl.subtitle': 'Video or audio from any link, in the format and quality you choose',
      'dl.placeholder': 'Paste a YouTube, TikTok, Instagram, X, Vimeo, SoundCloud link…',
      'dl.paste': 'Paste', 'dl.analyze': 'Analyze', 'dl.noLink': 'No valid link found',
      'dl.analyzing': 'Reading the link…', 'dl.analyzingSub': 'yt-dlp is listing the available formats', 'dl.cantRead': "Can't read this link",
      'dl.video': 'Video', 'dl.audio': 'Audio', 'dl.quality': 'Quality', 'dl.best': 'Best', 'dl.bestQuality': 'Best quality', 'dl.lossless': 'Lossless',
      'dl.download': 'Download', 'dl.connecting': 'Connecting…', 'dl.finalizing': 'Finalizing…', 'dl.extracting': 'Extracting audio', 'dl.merging': 'Merging video + audio',
      'dl.done': 'Downloaded: {title}', 'dl.failed': 'Download failed', 'dl.notify': 'Download complete',
      'dl.emptyTitle': 'Paste a link to start', 'dl.emptySub': '1,000+ sites supported by yt-dlp · you can also drag a link from your browser',
      'dl.list': 'Downloads', 'dl.dest': 'Downloads', 'dl.destTip': 'Windows Downloads folder', 'dl.destReset': 'Back to the Downloads folder',
      'dl.update': 'Update', 'dl.updating': 'Updating yt-dlp…', 'dl.missing': 'yt-dlp not found',
      'dl.missingSub': 'Install it with {cmd} and retry, or point to yt-dlp.exe.', 'dl.pick': 'Choose yt-dlp.exe…', 'dl.removeTip': 'Remove from list',

      'q.presets': 'Presets', 'q.formats': 'Formats',
      'preset.tiktok': 'TikTok / Shorts', 'preset.tiktok.sub': 'Vertical 9:16 · fast',
      'preset.youtube': 'Clean export', 'preset.youtube.sub': 'YouTube · high quality',
      'preset.proxy': 'Proxy for editing', 'preset.proxy.sub': 'ProRes · smooth timeline',
      'preset.audio': 'Extract audio', 'preset.audio.sub': 'WAV 24-bit',
      'hint.vfr': 'Variable frame rate', 'hint.vfrTip': 'Can drift out of sync in your editor. The presets fix it automatically.',
      'hint.bits': '{n}-bit', 'hint.tracks': '{n} audio tracks',
      'gpu.on': '⚡ GPU · {v}', 'gpu.off': 'CPU encoding (no compatible GPU)',
      'gpu.ready': '{v} ready', 'gpu.cpu': 'CPU encoding', 'gpu.checking': 'Checking GPU…',
      'adv.ai.model': 'AI model', 'adv.ai.fast': 'Fast', 'adv.ai.quality': 'Best quality (slower)',
      'enh.label': 'AI Enhance', 'enh.subtitle': 'Upscale or interpolate your videos with AI — 100% local, on your graphics card',
      'enh.hero': 'Drop videos to enhance with AI', 'enh.go': ({ n }) => (n > 1 ? `Enhance ${n} videos` : 'Enhance'), 'enh.notify': 'AI enhancement complete',
      'preset.upscale': 'Upscaling', 'preset.upscale.sub': 'Sharper and bigger, up to 4K', 'preset.interpolate': 'Interpolation', 'preset.interpolate.sub': 'Smoother motion, up to 60 fps',
      'enh.upList': '720p → 4K · Real-ESRGAN', 'enh.interpList': '24 → 60 fps · RIFE', 'enh.local': 'Private', 'enh.localList': '100% local · your GPU',
      'enh.res': 'Upscaling to', 'enh.fps': 'Interpolation to (fps)', 'enh.status': 'AI engine', 'enh.statusSub': 'Higher than the source = AI · lower = classic downscale',
      'ai.checking': 'Checking AI…', 'ai.ready': 'AI · {v}', 'ai.none': 'AI unavailable — no Vulkan GPU',
      'ai.prepare': 'Preparing frames', 'ai.upscale': 'AI upscaling', 'ai.interpolate': 'AI interpolation', 'ai.encode': 'Encoding',
      'err.AI_MISSING': 'AI engines are missing — reinstall MediaFlow Studio',
      'adv.toggle': 'Advanced', 'adv.titleAudio': 'Pro audio settings', 'adv.title': 'Pro settings — applied on top of the presets', 'adv.auto': 'Preset default',
      'adv.codec': 'Video codec', 'adv.container': 'Container', 'adv.depth': 'Bit depth',
      'adv.bits.8': '8-bit', 'adv.bits.10': '10-bit', 'adv.bits.16': '16-bit', 'adv.bits.24': '24-bit',
      'adv.fps': 'Frame rate', 'adv.fps.fix': 'Fix VFR only', 'adv.fps.keep': 'Keep source',
      'adv.height': 'Resolution', 'adv.source': 'Source', 'adv.audio': 'Audio',
      'adv.pcm16': 'PCM 16-bit', 'adv.pcm24': 'PCM 24-bit', 'adv.copy': 'Copy (no re-encode)',
      'adv.tracks': 'Audio tracks', 'adv.tracks.first': 'First track', 'adv.tracks.all': 'All tracks', 'adv.tracks.mix': 'Mix all tracks',
      'adv.gpu': 'GPU acceleration', 'adv.on': 'On', 'adv.gpu.off': 'Off (CPU only)',
      'adv.track': 'Track', 'adv.track.2': 'Track 2', 'adv.track.3': 'Track 3', 'adv.track.4': 'Track 4',
      'adv.channels': 'Channels', 'adv.channels.keep': 'Keep', 'adv.channels.mono': 'Mono', 'adv.channels.split': 'Split L / R (2 files)',
      'adv.rate': 'Sample rate',

      'up.check': 'Check for updates', 'up.checking': 'Checking for updates…', 'up.latest': "You're up to date (v{v})",
      'up.dev': 'Updates are checked in the installed app', 'up.available': 'Update available — v{v}',
      'up.availableSub': 'New features and fixes are ready.', 'up.availablePortable': 'Get the new portable version from GitHub.',
      'up.get': 'Update', 'up.download': 'Download', 'up.downloading': 'Downloading the update…',
      'up.ready': 'v{v} is ready', 'up.readySub': 'Restart to finish installing.', 'up.restart': 'Restart & Install',
      'up.error': "Couldn't update", 'up.busy': 'Finish running jobs before restarting', 'up.later': 'Later',

      'err.CANCELLED': 'Cancelled', 'err.UNSUPPORTED': 'Unsupported format', 'err.BAD_RANGE': 'The out point must be after the in point',
      'err.NO_AUDIO': 'This file has no audio track', 'err.UNREADABLE': 'Unreadable link',
      'err.PLAYLIST': 'This link is a playlist ({n} items): paste a single video link',
      'err.YTDLP_MISSING': 'yt-dlp not found', 'err.YTDLP_FAILED': 'yt-dlp failed (code {n})',
    },
    fr: {
      'app.tools': 'Outils', 'app.collapse': 'Réduire', 'app.collapseTip': 'Réduire la barre latérale',
      'app.sounds': 'Sons', 'app.soundsTip': "Sons de l'interface", 'app.langTip': 'Langue',
      'app.langBusy': 'Terminez les tâches en cours avant de changer de langue',
      'drop.title': 'Relâchez pour ajouter', 'drop.sub': 'Fichiers ou liens',
      'unit.kb': 'Ko', 'unit.mb': 'Mo', 'unit.gb': 'Go',
      'kind.image': 'Images', 'kind.audio': 'Audio', 'kind.video': 'Vidéo',
      'spec.fps': 'ips', 'spec.stereo': 'stéréo', 'spec.mono': 'mono', 'spec.pcm': 'PCM {bits} bits',
      'common.browse': 'ou cliquez pour parcourir', 'common.retry': 'Réessayer', 'common.cancel': 'Annuler', 'common.esc': 'Échap',
      'common.reveal': "Afficher dans l'Explorateur", 'common.left': '{t} restantes', 'common.estimating': 'Estimation…',
      'common.outputSource': 'Même dossier que la source', 'common.outputTip': 'Dossier de destination', 'common.outputReset': 'Revenir au dossier source',

      'q.queue': "File d'attente", 'q.files': ({ n }) => `${n} fichier${s(n)}`, 'q.add': 'Ajouter', 'q.cleanDone': 'Retirer les terminés', 'q.clear': 'Tout vider',
      'q.allTo': 'Tout en', 'q.ready': 'Prêt', 'q.queued': 'En file', 'q.cancelled': 'Annulé', 'q.failed': 'Échec', 'q.done': 'Terminé',
      'q.starting': 'Démarrage…', 'q.remove': 'Retirer de la file', 'q.outFmt': 'Format de sortie pour {name}',
      'q.overall': ({ i, n, left }) => `Fichier ${i} sur ${n}${left ? ` · environ ${left} restantes` : ''}`,
      'q.took': '→ {name} · en {time}',
      'q.skipped': ({ n }) => `${n} élément${s(n)} ignoré${s(n)} : format non pris en charge`,
      'q.cancelledToast': 'File annulée',
      'q.result': ({ ok, ko }) => (ko ? `${ok} terminé${s(ok)}, ${ko} échec${s(ko)}` : `${ok} fichier${s(ok)} terminé${s(ok)}`),

      'conv.label': 'Convertisseur', 'conv.subtitle': 'Images, audio et vidéo — qualité maximale, remux sans perte quand c’est possible',
      'conv.hero': 'Glissez vos médias ici', 'conv.go': ({ n }) => (n > 1 ? `Convertir ${n} fichiers` : 'Convertir'), 'conv.notify': 'Conversion terminée',

      'ext.label': 'Extracteur audio', 'ext.subtitle': "L'audio propre de n'importe quelle vidéo — normalisation et nettoyage intégrés",
      'ext.hero': 'Déposez des vidéos pour en extraire l’audio', 'ext.go': ({ n }) => (n > 1 ? `Extraire ${n} fichiers` : 'Extraire'), 'ext.notify': 'Extraction terminée',
      'ext.in': 'Depuis', 'ext.out': 'Vers', 'ext.clean': 'Nettoyage', 'ext.cleanList': 'Volume · Bruit · Coupe-bas',
      'ext.loudness': 'Volume', 'ext.loud.off': 'Niveau d’origine', 'ext.loud.14': 'Streaming · −14 LUFS',
      'ext.loud.16': 'Podcast · −16 LUFS', 'ext.loud.23': 'Télé · −23 LUFS',
      'ext.denoise': 'Réduire le bruit', 'ext.lowcut': 'Coupe-bas 80 Hz',

      'trim.label': 'Découpe', 'trim.subtitle': 'Coupez des extraits en quelques secondes — copie sans perte, sans réencodage',
      'trim.empty': 'Déposez une vidéo à découper', 'trim.emptySub': "Espace lit · I et O placent l'entrée et la sortie",
      'trim.in': 'Entrée', 'trim.out': 'Sortie', 'trim.length': 'Extrait',
      'trim.setIn': "Placer l'entrée (I)", 'trim.setOut': 'Placer la sortie (O)', 'trim.play': 'Lecture / pause (Espace)',
      'trim.fast': 'Rapide · sans perte', 'trim.precise': "Précis à l'image",
      'trim.modeTip': "Rapide copie les flux sans réencoder : instantané et sans perte, l'extrait commence sur l'image clé la plus proche. Précis réencode en qualité maximale.",
      'trim.export': "Exporter l'extrait", 'trim.open': 'Ouvrir une autre', 'trim.exporting': 'Export de {name}…',
      'trim.saved': 'Extrait enregistré : {name}', 'trim.notify': 'Extrait exporté', 'trim.showLast': 'Voir le dernier extrait',
      'trim.noPreview': "Pas d'aperçu pour ce codec — la timeline et l'export fonctionnent quand même",
      'trim.unsupported': 'Choisissez un fichier vidéo ou audio',

      'dl.label': 'Téléchargement', 'dl.subtitle': 'Vidéo ou audio depuis un lien, dans le format et la qualité de votre choix',
      'dl.placeholder': 'Collez un lien YouTube, TikTok, Instagram, X, Vimeo, SoundCloud…',
      'dl.paste': 'Coller', 'dl.analyze': 'Analyser', 'dl.noLink': 'Aucun lien valide détecté',
      'dl.analyzing': 'Analyse du lien…', 'dl.analyzingSub': 'yt-dlp lit les formats disponibles', 'dl.cantRead': 'Impossible de lire ce lien',
      'dl.video': 'Vidéo', 'dl.audio': 'Audio', 'dl.quality': 'Qualité', 'dl.best': 'Meilleure', 'dl.bestQuality': 'Meilleure qualité', 'dl.lossless': 'Sans perte',
      'dl.download': 'Télécharger', 'dl.connecting': 'Connexion…', 'dl.finalizing': 'Finalisation…', 'dl.extracting': 'Extraction audio', 'dl.merging': 'Assemblage vidéo + audio',
      'dl.done': 'Téléchargé : {title}', 'dl.failed': 'Échec du téléchargement', 'dl.notify': 'Téléchargement terminé',
      'dl.emptyTitle': 'Collez un lien pour commencer', 'dl.emptySub': 'Plus de 1 000 sites pris en charge par yt-dlp · vous pouvez aussi glisser un lien depuis le navigateur',
      'dl.list': 'Téléchargements', 'dl.dest': 'Téléchargements', 'dl.destTip': 'Dossier Téléchargements de Windows', 'dl.destReset': 'Revenir au dossier Téléchargements',
      'dl.update': 'Mettre à jour', 'dl.updating': 'Mise à jour de yt-dlp…', 'dl.missing': 'yt-dlp introuvable',
      'dl.missingSub': 'Installez-le avec {cmd} puis réessayez, ou indiquez où se trouve yt-dlp.exe.', 'dl.pick': 'Choisir yt-dlp.exe…', 'dl.removeTip': 'Retirer de la liste',

      'q.presets': 'Préréglages', 'q.formats': 'Formats',
      'preset.tiktok': 'TikTok / Shorts', 'preset.tiktok.sub': 'Vertical 9:16 · rapide',
      'preset.youtube': 'Export propre', 'preset.youtube.sub': 'YouTube · haute qualité',
      'preset.proxy': 'Proxy de montage', 'preset.proxy.sub': 'ProRes · timeline fluide',
      'preset.audio': "Extraire l'audio", 'preset.audio.sub': 'WAV 24 bits',
      'hint.vfr': 'Fréquence variable', 'hint.vfrTip': 'Peut se désynchroniser au montage. Les préréglages le corrigent automatiquement.',
      'hint.bits': '{n} bits', 'hint.tracks': '{n} pistes audio',
      'gpu.on': '⚡ GPU · {v}', 'gpu.off': 'Encodage CPU (pas de GPU compatible)',
      'gpu.ready': '{v} prêt', 'gpu.cpu': 'Encodage CPU', 'gpu.checking': 'Détection du GPU…',
      'adv.ai.model': 'Modèle IA', 'adv.ai.fast': 'Rapide', 'adv.ai.quality': 'Qualité max (plus lent)',
      'enh.label': 'Amélioration IA', 'enh.subtitle': 'Agrandissez ou fluidifiez vos vidéos avec l’IA — 100 % local, sur votre carte graphique',
      'enh.hero': 'Déposez des vidéos à améliorer avec l’IA', 'enh.go': ({ n }) => (n > 1 ? `Améliorer ${n} vidéos` : 'Améliorer'), 'enh.notify': 'Amélioration IA terminée',
      'preset.upscale': 'Upscaling', 'preset.upscale.sub': 'Plus net et plus grand, jusqu’en 4K', 'preset.interpolate': 'Interpolation', 'preset.interpolate.sub': 'Mouvement plus fluide, jusqu’à 60 i/s',
      'enh.upList': '720p → 4K · Real-ESRGAN', 'enh.interpList': '24 → 60 i/s · RIFE', 'enh.local': 'Privé', 'enh.localList': '100 % local · votre GPU',
      'enh.res': 'Upscaling vers', 'enh.fps': 'Interpolation vers (i/s)', 'enh.status': 'Moteur IA', 'enh.statusSub': 'Plus haut que la source = IA · plus bas = réduction classique',
      'ai.checking': 'Vérification de l’IA…', 'ai.ready': 'IA · {v}', 'ai.none': 'IA indisponible — pas de GPU Vulkan',
      'ai.prepare': 'Préparation des images', 'ai.upscale': 'Upscaling IA', 'ai.interpolate': 'Interpolation IA', 'ai.encode': 'Encodage',
      'err.AI_MISSING': 'Moteurs IA introuvables — réinstallez MediaFlow Studio',
      'adv.toggle': 'Avancé', 'adv.titleAudio': 'Réglages audio pro', 'adv.title': "Réglages pro — appliqués par-dessus les préréglages", 'adv.auto': 'Selon le préréglage',
      'adv.codec': 'Codec vidéo', 'adv.container': 'Conteneur', 'adv.depth': 'Profondeur',
      'adv.bits.8': '8 bits', 'adv.bits.10': '10 bits', 'adv.bits.16': '16 bits', 'adv.bits.24': '24 bits',
      'adv.fps': 'Images/s', 'adv.fps.fix': 'Corriger le VFR seulement', 'adv.fps.keep': 'Garder la source',
      'adv.height': 'Résolution', 'adv.source': 'Source', 'adv.audio': 'Audio',
      'adv.pcm16': 'PCM 16 bits', 'adv.pcm24': 'PCM 24 bits', 'adv.copy': 'Copier (sans réencodage)',
      'adv.tracks': 'Pistes audio', 'adv.tracks.first': 'Première piste', 'adv.tracks.all': 'Toutes les pistes', 'adv.tracks.mix': 'Mixer toutes les pistes',
      'adv.gpu': 'Accélération GPU', 'adv.on': 'Activée', 'adv.gpu.off': 'Désactivée (CPU seul)',
      'adv.track': 'Piste', 'adv.track.2': 'Piste 2', 'adv.track.3': 'Piste 3', 'adv.track.4': 'Piste 4',
      'adv.channels': 'Canaux', 'adv.channels.keep': 'Garder', 'adv.channels.mono': 'Mono', 'adv.channels.split': 'Séparer G / D (2 fichiers)',
      'adv.rate': 'Fréquence',

      'up.check': 'Rechercher des mises à jour', 'up.checking': 'Recherche de mises à jour…', 'up.latest': 'Vous êtes à jour (v{v})',
      'up.dev': "Les mises à jour sont vérifiées dans l'app installée", 'up.available': 'Mise à jour disponible — v{v}',
      'up.availableSub': 'De nouvelles fonctions et corrections sont prêtes.', 'up.availablePortable': 'Téléchargez la nouvelle version portable sur GitHub.',
      'up.get': 'Mettre à jour', 'up.download': 'Télécharger', 'up.downloading': 'Téléchargement de la mise à jour…',
      'up.ready': 'La v{v} est prête', 'up.readySub': 'Redémarrez pour terminer l’installation.', 'up.restart': 'Redémarrer et installer',
      'up.error': 'Mise à jour impossible', 'up.busy': 'Terminez les tâches en cours avant de redémarrer', 'up.later': 'Plus tard',

      'err.CANCELLED': 'Annulé', 'err.UNSUPPORTED': 'Format non pris en charge', 'err.BAD_RANGE': "La sortie doit être après l'entrée",
      'err.NO_AUDIO': "Ce fichier n'a pas de piste audio", 'err.UNREADABLE': 'Lien illisible',
      'err.PLAYLIST': "Ce lien est une playlist ({n} éléments) : collez le lien d'une seule vidéo",
      'err.YTDLP_MISSING': 'yt-dlp introuvable', 'err.YTDLP_FAILED': 'yt-dlp a échoué (code {n})',
    },
  };
  const LANGS = { en: 'English', fr: 'Français' };
  let lang = 'en';
  try { lang = dict[localStorage.getItem('lang')] ? localStorage.getItem('lang') : 'en'; } catch {}
  document.documentElement.lang = lang;

  function t(key, vars = {}) {
    const v = dict[lang][key] ?? dict.en[key] ?? key;
    return typeof v === 'function' ? v(vars) : v.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }
  // Backend errors arrive as codes ("CANCELLED", "PLAYLIST:12"); anything else is shown as-is.
  function error(e) {
    const msg = String(e?.message ?? e).replace(/^Error invoking remote method '[^']+': (Error: )?/, '');
    const [, code, arg] = /^([A-Z_]+)(?::(.*))?$/.exec(msg) || [];
    return code && dict.en[`err.${code}`] ? t(`err.${code}`, { n: arg }) : msg;
  }
  // Static markup: data-i18n (text), data-i18n-title (tooltip).
  function apply(root) {
    root.querySelectorAll('[data-i18n]').forEach((el) => { el.textContent = t(el.dataset.i18n); });
    root.querySelectorAll('[data-i18n-title]').forEach((el) => { el.title = t(el.dataset.i18nTitle); });
  }
  return { t, error, apply, LANGS, dict, get lang() { return lang; } };
})();
