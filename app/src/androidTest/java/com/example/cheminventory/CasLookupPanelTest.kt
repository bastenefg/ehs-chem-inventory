package com.example.cheminventory

import androidx.compose.foundation.layout.Column
import androidx.compose.foundation.layout.fillMaxSize
import androidx.compose.foundation.layout.padding
import androidx.compose.foundation.rememberScrollState
import androidx.compose.foundation.verticalScroll
import androidx.compose.ui.Modifier
import androidx.compose.ui.test.assertIsDisplayed
import androidx.compose.ui.test.junit4.createComposeRule
import androidx.compose.ui.test.onNodeWithText
import androidx.compose.ui.test.performClick
import androidx.compose.ui.test.performScrollTo
import androidx.compose.ui.unit.dp
import androidx.test.ext.junit.runners.AndroidJUnit4
import com.example.cheminventory.ui.theme.ChemInventoryTheme
import org.junit.Assert.assertEquals
import org.junit.Rule
import org.junit.Test
import org.junit.runner.RunWith

/** Renders only the lookup panel: no activity ViewModel, saved lab state, or network calls. */
@RunWith(AndroidJUnit4::class)
class CasLookupPanelTest {
    @get:Rule val compose = createComposeRule()

    @Test fun displayedCandidateCanBeSelectedWithoutAnotherDialogOrLookup() {
        val candidate = CasCandidate("64-17-5", "Ethanol", "C2H6O", "ethanol", 702L)
        val record = InventoryRecord(chemicalName = "Ethanol")
        val result = CasLookupResult(
            query = "Ethanol", candidates = listOf(candidate),
            message = "Check the exact identity against your label or supplier SDS.", status = CasLookupStatus.FOUND
        )
        val state = CasLookupUiState(recordId = record.id, query = record.chemicalName, result = result, message = result.message)
        val accepted = mutableListOf<CasCandidate>()
        var lookupCalls = 0
        compose.setContent {
            ChemInventoryTheme {
                Column(Modifier.fillMaxSize().verticalScroll(rememberScrollState()).padding(16.dp)) {
                    CasLookupPanel(record, state, onLookup = { lookupCalls++ }, onAccept = { accepted += it })
                }
            }
        }

        compose.onNodeWithText("64-17-5").performScrollTo().assertIsDisplayed()
        compose.onNodeWithText("Use this CAS").performScrollTo().performClick()
        compose.onNodeWithText("Confirm the substance").assertDoesNotExist()
        compose.runOnIdle {
            assertEquals(listOf(candidate), accepted)
            assertEquals("Selecting an existing proposal must not issue another lookup", 0, lookupCalls)
        }
    }
}
