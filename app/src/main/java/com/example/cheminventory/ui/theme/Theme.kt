package com.example.cheminventory.ui.theme

import androidx.compose.material3.MaterialTheme
import androidx.compose.material3.Shapes
import androidx.compose.material3.lightColorScheme
import androidx.compose.foundation.shape.RoundedCornerShape
import androidx.compose.runtime.Composable
import androidx.compose.ui.graphics.Color
import androidx.compose.ui.unit.dp

private val LabColors = lightColorScheme(
    primary = Color(0xFF245447), onPrimary = Color.White,
    primaryContainer = Color(0xFFE3ECE7), onPrimaryContainer = Color(0xFF263238),
    secondary = Color(0xFF626970), secondaryContainer = Color(0xFFE3E7EA),
    tertiary = Color(0xFFA31F34), background = Color(0xFFF7F8FA),
    surface = Color.White, onSurface = Color(0xFF263238), onBackground = Color(0xFF263238),
    outline = Color(0xFF899298), surfaceVariant = Color(0xFFE3E7EA), onSurfaceVariant = Color(0xFF626970)
)

@Composable
fun ChemInventoryTheme(content: @Composable () -> Unit) {
    MaterialTheme(colorScheme = LabColors, typography = Typography,
        shapes = Shapes(extraSmall = RoundedCornerShape(4.dp), small = RoundedCornerShape(6.dp),
            medium = RoundedCornerShape(8.dp), large = RoundedCornerShape(8.dp), extraLarge = RoundedCornerShape(12.dp)),
        content = content)
}
