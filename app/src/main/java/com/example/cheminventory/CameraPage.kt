package com.example.cheminventory

import android.Manifest
import android.content.Context
import android.content.pm.PackageManager
import android.graphics.Bitmap
import android.graphics.BitmapFactory
import android.graphics.ImageDecoder
import android.graphics.Matrix
import android.os.Build
import androidx.activity.compose.rememberLauncherForActivityResult
import androidx.activity.compose.BackHandler
import androidx.activity.result.contract.ActivityResultContracts
import androidx.camera.core.CameraSelector
import androidx.camera.core.ImageCapture
import androidx.camera.core.ImageCaptureException
import androidx.camera.core.Preview
import androidx.camera.lifecycle.ProcessCameraProvider
import androidx.camera.view.PreviewView
import androidx.compose.foundation.BorderStroke
import androidx.compose.foundation.background
import androidx.compose.foundation.border
import androidx.compose.foundation.layout.*
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.material3.*
import androidx.compose.runtime.*
import androidx.compose.ui.Alignment
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.platform.LocalContext
import androidx.compose.ui.platform.LocalLifecycleOwner
import androidx.compose.ui.platform.testTag
import androidx.compose.ui.unit.dp
import androidx.compose.ui.viewinterop.AndroidView
import androidx.core.content.ContextCompat
import androidx.exifinterface.media.ExifInterface
import java.io.File
import kotlin.math.max
import kotlin.math.roundToInt

@Composable
fun CameraPage(room: String, onBack: () -> Unit, onCaptured: (File) -> Unit) {
    val context = LocalContext.current
    val owner = LocalLifecycleOwner.current
    var granted by remember { mutableStateOf(ContextCompat.checkSelfPermission(context, Manifest.permission.CAMERA) == PackageManager.PERMISSION_GRANTED) }
    var error by remember { mutableStateOf("") }
    var capturing by remember { mutableStateOf(false) }
    BackHandler(enabled = capturing) { /* Keep the capture callback on this screen. */ }
    var capture by remember { mutableStateOf<ImageCapture?>(null) }
    val permission = rememberLauncherForActivityResult(ActivityResultContracts.RequestPermission()) { granted = it }
    val preview = remember { PreviewView(context).apply { implementationMode = PreviewView.ImplementationMode.COMPATIBLE } }
    LaunchedEffect(Unit) { if (!granted) permission.launch(Manifest.permission.CAMERA) }
    DisposableEffect(granted, owner) {
        var disposed = false
        var boundProvider: ProcessCameraProvider? = null
        var boundPreview: Preview? = null
        var boundCapture: ImageCapture? = null
        if (granted) {
            val future = ProcessCameraProvider.getInstance(context)
            future.addListener({
                if (!disposed) {
                    try {
                        val provider = future.get()
                        val previewUseCase = Preview.Builder().build().also { it.setSurfaceProvider(preview.surfaceProvider) }
                        val captureUseCase = ImageCapture.Builder().setCaptureMode(ImageCapture.CAPTURE_MODE_MINIMIZE_LATENCY).build()
                        provider.bindToLifecycle(owner, CameraSelector.DEFAULT_BACK_CAMERA, previewUseCase, captureUseCase)
                        boundProvider = provider; boundPreview = previewUseCase; boundCapture = captureUseCase
                        capture = captureUseCase
                    } catch (_: Exception) { error = "The camera could not be opened. Return to Scan and choose an existing photo." }
                }
            }, ContextCompat.getMainExecutor(context))
        }
        onDispose {
            disposed = true
            capture = null
            boundPreview?.let { boundProvider?.unbind(it) }
            boundCapture?.let { boundProvider?.unbind(it) }
        }
    }
    Column(Modifier.fillMaxSize().background(Color(0xFF263238))) {
        Row(Modifier.fillMaxWidth().padding(16.dp), verticalAlignment = Alignment.CenterVertically) {
            TextButton(onClick = onBack, enabled = !capturing) { Text("‹  Back", color = Color.White) }
            Spacer(Modifier.weight(1f))
            Text(room.ifBlank { "Label capture" }, color = Color.White)
        }
        if (granted && error.isBlank()) {
            Box(Modifier.fillMaxWidth().weight(1f)) {
                AndroidView(factory = { preview }, modifier = Modifier.fillMaxSize())
                Box(Modifier.align(Alignment.Center).fillMaxWidth(.85f).fillMaxHeight(.6f).border(BorderStroke(2.dp, Color.White), RoundedCornerShape(8.dp)))
                Surface(modifier = Modifier.align(Alignment.TopCenter).padding(24.dp), color = Color.Black.copy(alpha = .65f), shape = RoundedCornerShape(12.dp)) {
                    Text("Fit the chemical label inside the frame", color = Color.White, modifier = Modifier.padding(14.dp))
                }
            }
        } else {
            Column(Modifier.weight(1f).fillMaxWidth().padding(28.dp), verticalArrangement = Arrangement.Center, horizontalAlignment = Alignment.CenterHorizontally) {
                Text(error.ifBlank { "Allow camera access to photograph a label. You can also import a photo from the Scan screen." }, color = Color.White)
                if (!granted) TextButton(onClick = { permission.launch(Manifest.permission.CAMERA) }) { Text("Allow camera", color = Color.White) }
            }
        }
        Column(Modifier.fillMaxWidth().padding(24.dp), horizontalAlignment = Alignment.CenterHorizontally, verticalArrangement = Arrangement.spacedBy(12.dp)) {
            if (capturing) CaptureProgress()
            else Text("Keep the name, amount and CAS number readable.", color = Color(0xFFCFDED4), style = MaterialTheme.typography.bodySmall)
            Button(onClick = {
                val activeCapture = capture ?: return@Button
                capturing = true
                val file = try { File.createTempFile("camera_label_", ".jpg", context.cacheDir) }
                catch (_: Exception) { capturing = false; error = "Not enough space to capture a photo."; return@Button }
                activeCapture.targetRotation = preview.display?.rotation ?: android.view.Surface.ROTATION_0
                try { activeCapture.takePicture(ImageCapture.OutputFileOptions.Builder(file).build(), ContextCompat.getMainExecutor(context), object : ImageCapture.OnImageSavedCallback {
                    override fun onImageSaved(outputFileResults: ImageCapture.OutputFileResults) { capturing = false; onCaptured(file) }
                    override fun onError(exception: ImageCaptureException) { file.delete(); capturing = false; error = "Capture failed. Return to Scan and try another photo." }
                }) } catch (_: Exception) {
                    file.delete(); capturing = false
                    error = "The camera became unavailable. Return to Scan and try again."
                }
            }, enabled = capture != null && !capturing && error.isBlank(), shape = RoundedCornerShape(8.dp), modifier = Modifier.fillMaxWidth().heightIn(min = 56.dp),
                colors = ButtonDefaults.buttonColors(containerColor = Color(0xFFDBF1D8), contentColor = Color(0xFF17352F))) { Text(if (capturing) "Capturing…" else "Capture label") }
        }
    }
}

@Composable
internal fun CaptureProgress() {
    Column(Modifier.fillMaxWidth(), verticalArrangement = Arrangement.spacedBy(8.dp)) {
        Text("Capturing photo…", color = Color.White, style = MaterialTheme.typography.bodyMedium)
        LinearProgressIndicator(modifier = Modifier.fillMaxWidth().testTag("capture-progress"), color = Color(0xFFDBF1D8), trackColor = Color(0xFF52615B))
    }
}

/** Decode at bounded resolution, honor photo rotation, and remove metadata from upload. */
fun prepareLabelImage(context: Context, input: File): File {
    val edge = 1600
    val decoded = if (Build.VERSION.SDK_INT >= 28) {
        ImageDecoder.decodeBitmap(ImageDecoder.createSource(input)) { decoder, info, _ ->
            val ratio = minOf(1f, edge.toFloat() / max(info.size.width, info.size.height))
            decoder.setTargetSize((info.size.width * ratio).roundToInt().coerceAtLeast(1), (info.size.height * ratio).roundToInt().coerceAtLeast(1))
            decoder.allocator = ImageDecoder.ALLOCATOR_SOFTWARE
        }
    } else {
        val options = BitmapFactory.Options().apply { inJustDecodeBounds = true }
        BitmapFactory.decodeFile(input.path, options)
        require(options.outWidth > 0 && options.outHeight > 0) { "Choose a readable image." }
        var sample = 1
        while (max(options.outWidth, options.outHeight) / sample > edge * 2) sample *= 2
        val raw = BitmapFactory.decodeFile(input.path, BitmapFactory.Options().apply { inSampleSize = sample }) ?: error("Choose a readable image.")
        val exif = ExifInterface(input)
        val matrix = Matrix().apply {
            if (exif.isFlipped) postScale(-1f, 1f)
            postRotate(exif.rotationDegrees.toFloat())
        }
        val rotated = Bitmap.createBitmap(raw, 0, 0, raw.width, raw.height, matrix, true)
        if (rotated !== raw) raw.recycle()
        rotated
    }
    val ratio = minOf(1f, edge.toFloat() / max(decoded.width, decoded.height))
    val scaled = if (ratio < 1) Bitmap.createScaledBitmap(decoded, (decoded.width * ratio).roundToInt().coerceAtLeast(1), (decoded.height * ratio).roundToInt().coerceAtLeast(1), true) else decoded
    val out = File.createTempFile("upload_", ".jpg", context.cacheDir)
    try {
        out.outputStream().use { require(scaled.compress(Bitmap.CompressFormat.JPEG, 85, it)) { "Could not prepare the photo." } }
        return out
    } catch (e: Exception) { out.delete(); throw e }
    finally { if (scaled !== decoded) decoded.recycle(); scaled.recycle() }
}
