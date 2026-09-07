package com.example.cheminventory

import android.graphics.Bitmap
import androidx.compose.foundation.background
import androidx.compose.foundation.layout.Box
import androidx.compose.foundation.layout.fillMaxWidth
import androidx.compose.foundation.layout.padding
import androidx.compose.runtime.getValue
import androidx.compose.runtime.mutableStateOf
import androidx.compose.runtime.setValue
import androidx.compose.ui.Modifier
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.semantics.ProgressBarRangeInfo
import androidx.compose.ui.semantics.SemanticsProperties
import androidx.compose.ui.test.SemanticsMatcher
import androidx.compose.ui.test.assert
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithTag
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import com.example.cheminventory.ui.theme.ChemInventoryTheme
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import java.io.File

/** Real progress states rendered with fixture times; never calls the camera, Parley or Sheets. */
@RunWith(AndroidJUnit4::class)
class ScanProgressTest {
    @get:Rule val compose = createComposeRule()

    @Test fun scanBarRemainsIndeterminateAcrossRealStages() {
        var stage by mutableStateOf("Importing photo…")
        compose.setContent { ChemInventoryTheme { ScanProgress(stage, 4) } }
        listOf("Importing photo…", "Preparing photo…", "Reading label…", "Opening record…").forEach { next ->
            compose.runOnIdle { stage = next }
            compose.onNodeWithText(next).assertIsDisplayed()
            compose.onNodeWithText("4s elapsed").assertIsDisplayed()
            compose.onNodeWithTag("scan-progress").assertIsDisplayed().assert(
                SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo, ProgressBarRangeInfo.Indeterminate)
            )
        }
        compose.runOnIdle { stage = "Reading label…" }
        captureScreen("progress")
    }

    @Test fun captureFeedbackHasAnIndeterminateBarBeforeRecognitionStarts() {
        compose.setContent {
            ChemInventoryTheme {
                Box(Modifier.fillMaxWidth().background(Color(0xFF263238)).padding(24.dp)) { CaptureProgress() }
            }
        }
        compose.onNodeWithText("Capturing photo…").assertIsDisplayed()
        compose.onNodeWithTag("capture-progress").assertIsDisplayed().assert(
            SemanticsMatcher.expectValue(SemanticsProperties.ProgressBarRangeInfo, ProgressBarRangeInfo.Indeterminate)
        )
    }

    private fun captureScreen(name: String) {
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        val folder = File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null), "screenshots").apply { mkdirs() }
        File(folder, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
