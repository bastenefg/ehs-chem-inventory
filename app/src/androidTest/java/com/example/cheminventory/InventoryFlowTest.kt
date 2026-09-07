package com.example.cheminventory

import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.assertTextContains
import androidx.compose.ui.test.captureToImage
import androidx.compose.ui.test.onRoot
import androidx.compose.ui.graphics.asAndroidBitmap
import androidx.compose.ui.test.junit4.createAndroidComposeRule
import androidx.compose.ui.test.onAllNodesWithText
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.test.performTextInput
import androidx.test.ext.junit.runners.AndroidJUnit4
import androidx.test.platform.app.InstrumentationRegistry
import androidx.lifecycle.ViewModelProvider
import org.junit.Assert.assertEquals
import org.junit.Assert.assertTrue
import org.junit.Assume.assumeTrue
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith
import android.graphics.Bitmap
import java.io.File

/** Run on a clean disposable emulator. This test never connects Parley or Google Sheets. */
@RunWith(AndroidJUnit4::class)
class InventoryFlowTest {
    @get:Rule val compose = createAndroidComposeRule<MainActivity>()

    @Test fun onboardingManualDraftAndActivityRecreationPreserveEdits() {
        val context = InstrumentationRegistry.getInstrumentation().targetContext
        val store = InventoryStore(context)
        val settings = store.loadSettings()
        assumeTrue("Use a clean disposable emulator; existing lab data is never replaced by this test.",
            store.loadRecords().isEmpty() && settings.pi.isBlank() && settings.parleyApiKey.isBlank() && settings.sheetEndpoint.isBlank())

        compose.waitUntil(10_000) { compose.onAllNodesWithText("PI / supervisor").fetchSemanticsNodes().isNotEmpty() }
        compose.activityRule.scenario.onActivity { activity ->
            val model = ViewModelProvider(activity)[InventoryViewModel::class.java]
            model.setupDraft = model.setupDraft.copy(autoCasLookup = false)
        }
        compose.waitForIdle()
        captureScreen("setup")
        compose.onNodeWithText("Lab name").performTextInput("Instrumentation lab")
        compose.onNodeWithText("PI / supervisor").performTextInput("Test PI")
        compose.onNodeWithText("Default building-room").performTextInput("1-101")
        compose.onNodeWithText("Save lab setup").performScrollTo().performClick()
        compose.waitUntil(10_000) { compose.onAllNodesWithText("Got it").fetchSemanticsNodes().isNotEmpty() }
        compose.onNodeWithText("Got it").performClick()
        captureScreen("scan")
        compose.onNodeWithText("Add a record manually").performScrollTo().performClick()
        compose.onNodeWithText("Chemical name · required").performScrollTo().performTextInput("Ethanol UI fixture")
        compose.activityRule.scenario.onActivity { activity ->
            activity.currentFocus?.clearFocus()
        }
        captureScreen("review")
        compose.onNodeWithText("Amount per container · required").performScrollTo().performTextInput("250")
        compose.onNodeWithText("Notes / storage location").performScrollTo().performTextInput("Cabinet A; verify label before sending")
        compose.onNodeWithText("Keep draft for later").performScrollTo().performClick()
        compose.onNodeWithText("Ethanol UI fixture").assertIsDisplayed()
        compose.waitUntil(10_000) {
            store.loadRecords().singleOrNull()?.let {
                it.chemicalName == "Ethanol UI fixture" && it.amount == "250" && it.notes == "Cabinet A; verify label before sending"
            } == true
        }
        val savedId = store.loadRecords().single().id
        compose.activityRule.scenario.recreate()
        compose.onNodeWithText("Ethanol UI fixture").assertIsDisplayed().performClick()
        compose.onNodeWithText("Amount per container · required").performScrollTo().assertTextContains("250")
        compose.onNodeWithText("Notes / storage location").performScrollTo().assertTextContains("Cabinet A; verify label before sending")
        assertEquals(savedId, store.loadRecords().single().id)
        assertEquals("draft", store.loadRecords().single().syncState)
        assertTrue(store.loadSettings().parleyApiKey.isBlank())
        assertTrue(store.loadSettings().sheetEndpoint.isBlank())
    }

    private fun captureScreen(name: String) {
        val image = compose.onRoot().captureToImage().asAndroidBitmap()
        val folder = File(InstrumentationRegistry.getInstrumentation().targetContext.getExternalFilesDir(null), "screenshots").apply { mkdirs() }
        File(folder, "$name.png").outputStream().use { image.compress(Bitmap.CompressFormat.PNG, 100, it) }
    }
}
